import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { buildAssSubtitles, type AssMovieDescription } from "./assSubtitles";
import { resolveFfmpegPath, resolveFontPath } from "./runtimeAssets";

const execFileAsync = promisify(execFile);

export const VIDEO_SIZE = 720;
export const VIDEO_FPS = 24;
export const VIDEO_PIXEL_FORMAT = "yuv420p";

export const TITLE_CARD_DURATION = 2.5;
const SCENE_1_VISIBLE_DURATION = 4.5;
const SCENE_1_TRANSITION_DURATION = 0.4;
const SCENE_1_INPUT_DURATION = SCENE_1_VISIBLE_DURATION + SCENE_1_TRANSITION_DURATION;
const SCENE_2_DURATION = 4.0;
const SCENE_3_DURATION = 3.0;
const SCENE_3_BLACK_FRAMES = VIDEO_FPS / 2;
const SCENE_FADE_DURATION = 0.3;
export const END_CARD_DURATION = 3.3;
export const OUTPUT_DURATION = 18.2;

const FFMPEG_MAX_BUFFER = 10 * 1_024 * 1_024;
const SCENE_COUNT = 3;
const CONCAT_SEGMENT_COUNT = 5;
const TITLE_INPUT_INDEX = 3;
const END_CARD_INPUT_INDEX = 4;
const SCENE_FILE_NAMES = ["scene-1.mp4", "scene-2.mp4", "scene-3.mp4"] as const;
const ASS_FILE_NAME = "movie.ass";
const OUTPUT_FILE_NAME = "output.mp4";

export const MOVIE_TIMELINE = Object.freeze({
  title: Object.freeze({ start: 0, end: 2.5 }),
  scene1: Object.freeze({ start: 2.5, end: 7.0 }),
  scene1FadeToBlack: Object.freeze({ start: 7.0, end: 7.4 }),
  scene2: Object.freeze({ start: 7.4, end: 11.4 }),
  scene3: Object.freeze({ start: 11.4, end: 14.4 }),
  black: Object.freeze({ start: 14.4, end: 14.9 }),
  endCard: Object.freeze({ start: 14.9, end: 18.2 }),
});

export type MovieDescription = AssMovieDescription;

export interface BuildFfmpegArgsInput {
  readonly scenePaths: readonly string[];
  readonly assPath: string;
  readonly fontsDirectory: string;
  readonly outputPath: string;
}

/** filter_complex内で使うパスだけをFFmpegの規則でエスケープする。 */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/gu, "\\\\").replace(/:/gu, "\\:").replace(/'/gu, "\\'");
}

function buildBlackInputArgs(duration: number): readonly string[] {
  return [
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${VIDEO_SIZE}x${VIDEO_SIZE}:r=${VIDEO_FPS}:d=${duration}`,
  ];
}

function buildIntroFilter(): string {
  return [
    `[${TITLE_INPUT_INDEX}:v]`,
    `format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1[intro]",
  ].join("");
}

function buildScene1Filter(): string {
  return [
    "[0:v]",
    `trim=start=0:end=${SCENE_1_INPUT_DURATION}`,
    ",setpts=PTS-STARTPTS",
    `,fps=${VIDEO_FPS}`,
    `,format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1",
    `,fade=t=in:st=0:d=${SCENE_FADE_DURATION}`,
    `,fade=t=out:st=${SCENE_1_VISIBLE_DURATION}:d=${SCENE_1_TRANSITION_DURATION}`,
    "[scene1]",
  ].join("");
}

function buildScene2Filter(): string {
  const fadeOutStart = SCENE_2_DURATION - SCENE_FADE_DURATION;
  return [
    "[1:v]",
    `trim=start=0:end=${SCENE_2_DURATION}`,
    ",setpts=PTS-STARTPTS",
    `,fps=${VIDEO_FPS}`,
    `,format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1",
    `,fade=t=in:st=0:d=${SCENE_FADE_DURATION}`,
    `,fade=t=out:st=${fadeOutStart}:d=${SCENE_FADE_DURATION}`,
    "[scene2]",
  ].join("");
}

function buildScene3Filter(): string {
  const fadeOutStart = SCENE_3_DURATION - SCENE_FADE_DURATION;
  return [
    "[2:v]",
    `trim=start=0:end=${SCENE_3_DURATION}`,
    ",setpts=PTS-STARTPTS",
    `,fps=${VIDEO_FPS}`,
    `,format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1",
    `,fade=t=in:st=0:d=${SCENE_FADE_DURATION}`,
    `,fade=t=out:st=${fadeOutStart}:d=${SCENE_FADE_DURATION}`,
    // 秒指定は同梱FFmpeg 7.0.2で追加フレームが欠落したため、24fpsの12枚を明示する。
    `,tpad=stop_mode=add:stop=${SCENE_3_BLACK_FRAMES}:color=black`,
    "[scene3]",
  ].join("");
}

function buildEndCardFilter(): string {
  return [
    `[${END_CARD_INPUT_INDEX}:v]`,
    `format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1[endcard]",
  ].join("");
}

function buildAssFilter(input: BuildFfmpegArgsInput): string {
  const assPath = escapeFilterPath(input.assPath);
  const fontsDirectory = escapeFilterPath(input.fontsDirectory);
  return `[base]ass=filename='${assPath}':fontsdir='${fontsDirectory}'[outv]`;
}

/** 5区間の結合とASS字幕描画を単一filter_complexへまとめる。 */
export function buildFilterComplex(input: BuildFfmpegArgsInput): string {
  return [
    buildIntroFilter(),
    buildScene1Filter(),
    buildScene2Filter(),
    buildScene3Filter(),
    buildEndCardFilter(),
    `[intro][scene1][scene2][scene3][endcard]concat=n=${CONCAT_SEGMENT_COUNT}:v=1:a=0[base]`,
    buildAssFilter(input),
  ].join(";");
}

function validateBuildInput(input: BuildFfmpegArgsInput): void {
  if (input.scenePaths.length !== SCENE_COUNT) {
    throw new Error(`scenePaths は${SCENE_COUNT}本必要です`);
  }
}

export function buildFfmpegArgs(input: BuildFfmpegArgsInput): readonly string[] {
  validateBuildInput(input);
  return [
    "-y",
    ...input.scenePaths.flatMap((path) => ["-i", path]),
    ...buildBlackInputArgs(TITLE_CARD_DURATION),
    ...buildBlackInputArgs(END_CARD_DURATION),
    "-filter_complex",
    buildFilterComplex(input),
    "-map",
    "[outv]",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    VIDEO_PIXEL_FORMAT,
    "-r",
    String(VIDEO_FPS),
    "-video_track_timescale",
    "24000",
    "-preset",
    "veryfast",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}

async function writeSceneFiles(
  directory: string,
  sceneVideos: readonly Uint8Array[],
): Promise<readonly string[]> {
  // directoryはmkdtempで作った実行時一時領域。ビルド時のファイル追跡対象ではない。
  const paths = SCENE_FILE_NAMES.map((name) => join(/* turbopackIgnore: true */ directory, name));
  await Promise.all(paths.map((path, index) => writeFile(path, sceneVideos[index])));
  return paths;
}

function validateMovie(sceneVideos: readonly Uint8Array[], movie: MovieDescription): void {
  if (sceneVideos.length !== SCENE_COUNT) {
    throw new Error(`sceneVideos は${SCENE_COUNT}本必要です`);
  }
  if (movie.scenes.length !== SCENE_COUNT) {
    throw new Error(`movie.scenes は${SCENE_COUNT}件必要です`);
  }
}

async function executeFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<void> {
  await execFileAsync(ffmpegPath, [...args], {
    timeout: timeoutMs,
    maxBuffer: FFMPEG_MAX_BUFFER,
    windowsHide: true,
    killSignal: "SIGKILL",
  });
}

/** 3シーンからASS字幕付き18.2秒の予告編を1パスで生成する。 */
export async function composeMovie(
  sceneVideos: Uint8Array[],
  movie: MovieDescription,
  timeoutMs: number,
): Promise<Uint8Array> {
  validateMovie(sceneVideos, movie);
  const directory = await mkdtemp(join(tmpdir(), "compose-movie-"));
  try {
    const [ffmpegPath, fontPath] = await Promise.all([resolveFfmpegPath(), resolveFontPath()]);
    const scenePaths = await writeSceneFiles(directory, sceneVideos);
    const assPath = join(directory, ASS_FILE_NAME);
    const outputPath = join(directory, OUTPUT_FILE_NAME);
    await writeFile(assPath, buildAssSubtitles(movie), "utf8");
    await executeFfmpeg(ffmpegPath, buildFfmpegArgs({
      scenePaths,
      assPath,
      fontsDirectory: dirname(fontPath),
      outputPath,
    }), timeoutMs);
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
