import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  AI_DURATION_SECONDS,
  AI_GENERATION_DURATION_SECONDS,
  HYBRID_DURATION_SECONDS,
  MEMORY_DURATION_SECONDS,
  MEMORY_TIMELINE_DURATION_SECONDS,
} from "../generateHybridMoviePlan";
import { buildHybridAssSubtitles, type HybridSubtitleDescription } from "./hybridAssSubtitles";
import { escapeFilterPath, VIDEO_FPS, VIDEO_PIXEL_FORMAT, VIDEO_SIZE } from "./composeMovie";
import { resolveFfmpegPath, resolveFontPath } from "./runtimeAssets";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 20 * 1_024 * 1_024;
const VIDEO_CLIP_DURATION = 3;
const MAX_MEMORY_VIDEOS = 4;
export const INTRO_BLACK_DURATION = 2;
export const BLACK_GAP_DURATION = 0.5;
const MAX_BLACK_GAPS = 5;

export type MemoryPhoto = { data: Uint8Array; number: number };
export type MemoryVideo = { data: Uint8Array };

/** 同じファイルが別レコードで登録されても、タイムラインには一度しか置かない。 */
export function deduplicateMemoryPhotos(photos: readonly MemoryPhoto[]): MemoryPhoto[] {
  const seen = new Set<string>();
  return photos.filter((photo) => {
    const digest = createHash("sha256").update(photo.data).digest("hex");
    if (seen.has(digest)) return false;
    seen.add(digest);
    return true;
  });
}

async function run(ffmpegPath: string, args: readonly string[], timeoutMs: number) {
  await execFileAsync(ffmpegPath, [...args], {
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    killSignal: "SIGKILL",
  });
}

function photoFilter(inputIndex: number, outputIndex: number, duration: number): string {
  const frames = Math.round(duration * VIDEO_FPS);
  const bars = outputIndex % 6 === 4
    ? ",crop=720:520:0:100,pad=720:720:0:100:black"
    : "";
  return [
    `[${inputIndex}:v]`,
    "scale=900:900:force_original_aspect_ratio=increase",
    ",crop=900:900",
    `,zoompan=z='min(zoom+0.0012\\,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${VIDEO_SIZE}x${VIDEO_SIZE}:fps=${VIDEO_FPS}`,
    `,trim=end=${duration},setpts=PTS-STARTPTS`,
    bars,
    ",eq=contrast=1.10:saturation=0.88:brightness=-0.025",
    ",vignette=PI/5",
    `,fps=${VIDEO_FPS},format=${VIDEO_PIXEL_FORMAT},setsar=1`,
    `,trim=end_frame=${frames}[p${outputIndex}]`,
  ].join("");
}

function videoFilter(inputIndex: number, outputIndex: number): string {
  return [
    `[${inputIndex}:v]`,
    `trim=start=0:end=${VIDEO_CLIP_DURATION},setpts=PTS-STARTPTS`,
    `,fps=${VIDEO_FPS}`,
    `,scale=${VIDEO_SIZE}:${VIDEO_SIZE}:force_original_aspect_ratio=increase`,
    `,crop=${VIDEO_SIZE}:${VIDEO_SIZE}`,
    `,tpad=stop_mode=clone:stop_duration=${VIDEO_CLIP_DURATION}`,
    `,trim=end=${VIDEO_CLIP_DURATION}`,
    ",eq=contrast=1.08:saturation=0.9:brightness=-0.02",
    `,format=${VIDEO_PIXEL_FORMAT},setsar=1[v${outputIndex}]`,
  ].join("");
}

function interleaveLabels(photoLabels: string[], videoLabels: string[]): string[] {
  if (videoLabels.length === 0) return photoLabels;
  const result: string[] = [];
  let videoIndex = 0;
  photoLabels.forEach((label, index) => {
    result.push(label);
    const boundary = Math.round(((videoIndex + 1) * photoLabels.length) / (videoLabels.length + 1));
    if (videoIndex < videoLabels.length && index + 1 >= boundary) {
      result.push(videoLabels[videoIndex]);
      videoIndex += 1;
    }
  });
  return [...result, ...videoLabels.slice(videoIndex)];
}

function blackBreakPhotoIndexes(photoCount: number): number[] {
  const breakCount = Math.min(MAX_BLACK_GAPS, Math.max(0, photoCount - 1));
  return [...new Set(Array.from({ length: breakCount }, (_, index) =>
    Math.min(photoCount - 2, Math.round(((index + 1) * photoCount) / (breakCount + 1)) - 1),
  ))];
}

export function buildMemoryTimelineLabels(photoCount: number, videoCount: number): {
  labels: string[];
  blackGapCount: number;
} {
  const photoLabels = Array.from({ length: photoCount }, (_, index) => `[p${index}]`);
  const videoLabels = Array.from({ length: videoCount }, (_, index) => `[v${index}]`);
  const breaks = new Set(blackBreakPhotoIndexes(photoCount));
  const interleaved = interleaveLabels(photoLabels, videoLabels);
  let gapIndex = 1;
  const labels = ["[black0]"];
  interleaved.forEach((label) => {
    labels.push(label);
    const match = /^\[p(\d+)\]$/u.exec(label);
    if (match && breaks.has(Number(match[1]))) {
      labels.push(`[black${gapIndex}]`);
      gapIndex += 1;
    }
  });
  return { labels, blackGapCount: gapIndex - 1 };
}

function blackFilter(label: string, duration: number): string {
  return `color=c=black:s=${VIDEO_SIZE}x${VIDEO_SIZE}:r=${VIDEO_FPS}:d=${duration},format=${VIDEO_PIXEL_FORMAT},setsar=1[${label}]`;
}

export async function composeMemoryMontage(
  photos: readonly MemoryPhoto[],
  videos: readonly MemoryVideo[],
  timeoutMs: number,
): Promise<Uint8Array> {
  const uniquePhotos = deduplicateMemoryPhotos(photos);
  if (uniquePhotos.length === 0) throw new Error("実素材の写真が1枚以上必要です");
  const selectedVideos = videos.slice(0, MAX_MEMORY_VIDEOS);
  const videoDuration = selectedVideos.length * VIDEO_CLIP_DURATION;
  const { labels, blackGapCount } = buildMemoryTimelineLabels(uniquePhotos.length, selectedVideos.length);
  const photoDuration = (MEMORY_DURATION_SECONDS - videoDuration) / uniquePhotos.length;
  if (photoDuration < 0.8) throw new Error("実素材のカット数が多すぎます");

  const directory = await mkdtemp(join(tmpdir(), "memory-montage-"));
  try {
    const ffmpegPath = await resolveFfmpegPath();
    const photoPaths = uniquePhotos.map((photo, index) => join(directory, `photo-${index}.jpg`));
    const videoPaths = selectedVideos.map((_, index) => join(directory, `memory-${index}.mp4`));
    await Promise.all([
      ...photoPaths.map((path, index) => writeFile(path, uniquePhotos[index].data)),
      ...videoPaths.map((path, index) => writeFile(path, selectedVideos[index].data)),
    ]);
    const outputPath = join(directory, "memory.mp4");
    const inputArgs = [
      ...photoPaths.flatMap((path) => ["-loop", "1", "-framerate", String(VIDEO_FPS), "-t", String(photoDuration), "-i", path]),
      ...videoPaths.flatMap((path) => ["-i", path]),
    ];
    const photoFilters = photoPaths.map((_, index) => photoFilter(index, index, photoDuration));
    const videoFilters = videoPaths.map((_, index) => videoFilter(photoPaths.length + index, index));
    const blackFilters = [
      blackFilter("black0", INTRO_BLACK_DURATION),
      ...Array.from({ length: blackGapCount }, (_, index) => blackFilter(`black${index + 1}`, BLACK_GAP_DURATION)),
    ];
    const filter = [
      ...photoFilters,
      ...videoFilters,
      ...blackFilters,
      `${labels.join("")}concat=n=${labels.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=1,trim=end=${MEMORY_TIMELINE_DURATION_SECONDS},setpts=PTS-STARTPTS[outv]`,
    ].join(";");
    await run(ffmpegPath, [
      "-y", ...inputArgs,
      "-filter_complex", filter,
      "-map", "[outv]", "-an", "-c:v", "libx264", "-preset", "veryfast",
      "-pix_fmt", VIDEO_PIXEL_FORMAT, "-r", String(VIDEO_FPS), "-movflags", "+faststart",
      outputPath,
    ], timeoutMs);
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function composeHybridMovie(
  memoryMontage: Uint8Array,
  aiVideo: Uint8Array,
  movie: HybridSubtitleDescription,
  timeoutMs: number,
): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "hybrid-movie-"));
  try {
    const [ffmpegPath, fontPath] = await Promise.all([resolveFfmpegPath(), resolveFontPath()]);
    const memoryPath = join(directory, "memory.mp4");
    const aiPath = join(directory, "ai.mp4");
    const assPath = join(directory, "movie.ass");
    const outputPath = join(directory, "output.mp4");
    await Promise.all([
      writeFile(memoryPath, memoryMontage),
      writeFile(aiPath, aiVideo),
      writeFile(assPath, buildHybridAssSubtitles(movie), "utf8"),
    ]);
    const escapedAss = escapeFilterPath(assPath);
    const escapedFonts = escapeFilterPath(dirname(fontPath));
    const filter = [
      `[0:v]trim=start=0:end=30,setpts=PTS-STARTPTS[m1]`,
      `[1:v]setpts=${AI_DURATION_SECONDS / AI_GENERATION_DURATION_SECONDS}*(PTS-STARTPTS),fps=${VIDEO_FPS},scale=${VIDEO_SIZE}:${VIDEO_SIZE}:force_original_aspect_ratio=increase,crop=${VIDEO_SIZE}:${VIDEO_SIZE},tpad=stop_mode=clone:stop_duration=1,trim=end=${AI_DURATION_SECONDS},format=${VIDEO_PIXEL_FORMAT},setsar=1[ai]`,
      `[0:v]trim=start=30:end=${MEMORY_TIMELINE_DURATION_SECONDS},setpts=PTS-STARTPTS[m2]`,
      `[m1][ai][m2]concat=n=3:v=1:a=0,trim=end=${HYBRID_DURATION_SECONDS}[base]`,
      `[base]ass=filename='${escapedAss}':fontsdir='${escapedFonts}'[outv]`,
    ].join(";");
    await run(ffmpegPath, [
      "-y", "-i", memoryPath, "-i", aiPath,
      "-filter_complex", filter, "-map", "[outv]", "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", VIDEO_PIXEL_FORMAT,
      "-r", String(VIDEO_FPS), "-t", String(HYBRID_DURATION_SECONDS),
      "-video_track_timescale", "24000", "-movflags", "+faststart", outputPath,
    ], timeoutMs);
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
