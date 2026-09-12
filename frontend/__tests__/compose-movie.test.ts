import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { composeMovie } from "@/lib/ai/video/composeMovie";
import { prepareHologramVideo } from "@/lib/ai/video/prepareHologramVideo";

const execFileAsync = promisify(execFile);
const systemFfmpegPath = ["/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"].find(existsSync);
const systemFfprobePath = ["/opt/homebrew/bin/ffprobe", "/usr/bin/ffprobe"].find(existsSync);
const canUseSystemFfmpeg = Boolean(systemFfmpegPath);

describe.skipIf(!canUseSystemFfmpeg)("composeMovie", () => {
  it("concatenates scene MP4s into a playable MP4", async () => {
    const directory = await mkdtemp(join(tmpdir(), "last-screen-test-"));
    try {
      const first = join(directory, "first.mp4");
      const second = join(directory, "second.mp4");
      if (!systemFfmpegPath) throw new Error("FFmpeg is unavailable");
      for (const [path, color] of [[first, "red"], [second, "blue"]] as const) {
        await execFileAsync(systemFfmpegPath, ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=32x32:d=0.1`, "-pix_fmt", "yuv420p", path]);
      }

      const movie = await composeMovie([new Uint8Array(await readFile(first)), new Uint8Array(await readFile(second))]);

      expect(movie.byteLength).toBeGreaterThan(100);
      expect(Buffer.from(movie.subarray(4, 8)).toString()).toBe("ftyp");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!systemFfmpegPath || !systemFfprobePath)("prepareHologramVideo", () => {
  it("16:9動画を720x720の正方形へ中央クロップする", async () => {
    const directory = await mkdtemp(join(tmpdir(), "last-screen-square-test-"));
    try {
      if (!systemFfmpegPath || !systemFfprobePath) throw new Error("FFmpeg is unavailable");
      const sourcePath = join(directory, "source.mp4");
      const outputPath = join(directory, "output.mp4");
      await execFileAsync(systemFfmpegPath, [
        "-y", "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=1",
        "-pix_fmt", "yuv420p", sourcePath,
      ]);

      const output = await prepareHologramVideo(new Uint8Array(await readFile(sourcePath)));
      await writeFile(outputPath, output);
      const { stdout } = await execFileAsync(systemFfprobePath, [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", outputPath,
      ]);
      expect(stdout.trim()).toBe("720x720");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("音声を除去し、連結可能なfpsへ固定する", async () => {
    const directory = await mkdtemp(join(tmpdir(), "last-screen-audio-test-"));
    try {
      if (!systemFfmpegPath || !systemFfprobePath) throw new Error("FFmpeg is unavailable");
      const sourcePath = join(directory, "source.mp4");
      const outputPath = join(directory, "output.mp4");
      // -an の効果を検証するため、音声トラックを持つ動画を用意する。
      await execFileAsync(systemFfmpegPath, [
        "-y", "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=1",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath,
      ]);

      const output = await prepareHologramVideo(new Uint8Array(await readFile(sourcePath)));
      await writeFile(outputPath, output);

      const { stdout: audioStreams } = await execFileAsync(systemFfprobePath, [
        "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=index", "-of", "csv=p=0", outputPath,
      ]);
      expect(audioStreams.trim()).toBe("");

      const { stdout: frameRate } = await execFileAsync(systemFfprobePath, [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", outputPath,
      ]);
      expect(frameRate.trim()).toBe("24/1");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
