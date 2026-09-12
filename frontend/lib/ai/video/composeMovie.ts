import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import bundledFfmpegPath from "ffmpeg-static";

import { VIDEO_CONCAT_TIMEOUT_MS } from "../timeouts";

const execFileAsync = promisify(execFile);
const SYSTEM_FFMPEG_PATHS = ["/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"];

async function resolveFfmpegPath() {
  const candidates = [process.env.FFMPEG_PATH, bundledFfmpegPath, ...SYSTEM_FFMPEG_PATHS];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next available binary source.
    }
  }
  throw new Error("FFmpeg binary is not available");
}

export async function composeMovie(sceneVideos: Uint8Array[]) {
  if (sceneVideos.length === 0) throw new Error("結合する動画がありません");
  const directory = await mkdtemp(join(tmpdir(), "last-screen-"));
  const outputPath = join(directory, "movie.mp4");

  try {
    const scenePaths = await Promise.all(sceneVideos.map(async (video, index) => {
      const scenePath = join(directory, `scene-${index + 1}.mp4`);
      await writeFile(scenePath, video);
      return scenePath;
    }));
    const listPath = join(directory, "scenes.txt");
    await writeFile(listPath, scenePaths.map((path) => `file '${path}'`).join("\n"));
    await execFileAsync(await resolveFfmpegPath(), [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c", "copy", "-movflags", "+faststart", outputPath,
    ], { timeout: VIDEO_CONCAT_TIMEOUT_MS, maxBuffer: 1_024 * 1_024 });
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
