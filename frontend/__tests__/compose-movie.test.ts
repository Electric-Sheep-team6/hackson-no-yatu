import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { composeMovie, OUTPUT_DURATION } from "@/lib/ai/video/composeMovie";
import { prepareHologramVideo } from "@/lib/ai/video/prepareHologramVideo";
import { VIDEO_CONCAT_TIMEOUT_MS } from "@/lib/ai/timeouts";

const execFileAsync = promisify(execFile);
const systemFfmpegPath = ["/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"].find(existsSync);
const systemFfprobePath = ["/opt/homebrew/bin/ffprobe", "/usr/bin/ffprobe"].find(existsSync);
const canUseSystemFfmpeg = Boolean(systemFfmpegPath);

describe.skipIf(!canUseSystemFfmpeg || !systemFfprobePath)("composeMovie", () => {
  it("3シーンから約18.2秒の予告編MP4を生成する", async () => {
    const directory = await mkdtemp(join(tmpdir(), "last-screen-test-"));
    try {
      if (!systemFfmpegPath || !systemFfprobePath) throw new Error("FFmpeg is unavailable");
      const scenePaths = ["scene-1.mp4", "scene-2.mp4", "scene-3.mp4"].map((name) =>
        join(directory, name),
      );
      for (const path of scenePaths) {
        await execFileAsync(systemFfmpegPath, [
          "-y", "-f", "lavfi", "-i", "color=c=red:s=720x720:r=24:d=5",
          "-pix_fmt", "yuv420p", path,
        ]);
      }

      const sceneVideos = await Promise.all(
        scenePaths.map(async (path) => new Uint8Array(await readFile(path))),
      );
      const movie = await composeMovie(
        sceneVideos,
        {
          title: "テストタイトル",
          logline: "テスト用のロゴラインです",
          scenes: [
            { narration: "シーン1のナレーション" },
            { narration: "シーン2のナレーション" },
            { narration: "シーン3のナレーション" },
          ],
        },
        VIDEO_CONCAT_TIMEOUT_MS,
      );

      expect(movie.byteLength).toBeGreaterThan(100);
      expect(Buffer.from(movie.subarray(4, 8)).toString()).toBe("ftyp");

      const outputPath = join(directory, "output.mp4");
      await writeFile(outputPath, movie);
      const { stdout } = await execFileAsync(systemFfprobePath, [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outputPath,
      ]);
      expect(Number(stdout.trim())).toBeCloseTo(OUTPUT_DURATION, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
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
