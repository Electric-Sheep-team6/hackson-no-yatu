import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const SQUARE_OUTPUT_SIZE = 720;
const VIDEO_PROCESS_TIMEOUT_MS = 120_000;
const SYSTEM_FFMPEG_PATHS = ["/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"];

async function resolveFfmpegPath(): Promise<string> {
  const candidates = [process.env.FFMPEG_PATH, ffmpegPath, ...SYSTEM_FFMPEG_PATHS];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 次の候補を確認する。
    }
  }
  throw new Error("FFmpeg binary is not available");
}

export async function prepareHologramVideo(
  video: Uint8Array,
): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), "last-screen-scene-"));
  const inputPath = join(directory, "source.mp4");
  const outputPath = join(directory, "square.mp4");
  try {
    await writeFile(inputPath, video);
    await execFileAsync(await resolveFfmpegPath(), [
      "-y", "-i", inputPath,
      "-vf", `crop='min(iw,ih)':'min(iw,ih)',scale=${SQUARE_OUTPUT_SIZE}:${SQUARE_OUTPUT_SIZE},setsar=1`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-movflags", "+faststart", outputPath,
    ], { timeout: VIDEO_PROCESS_TIMEOUT_MS });
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
