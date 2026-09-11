import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { composeMovie } from "@/lib/ai/video/composeMovie";

const execFileAsync = promisify(execFile);
const canUseSystemFfmpeg = existsSync("/usr/bin/ffmpeg");

describe.skipIf(!canUseSystemFfmpeg)("composeMovie", () => {
  it("concatenates scene MP4s into a playable MP4", async () => {
    const directory = await mkdtemp(join(tmpdir(), "last-screen-test-"));
    try {
      const first = join(directory, "first.mp4");
      const second = join(directory, "second.mp4");
      for (const [path, color] of [[first, "red"], [second, "blue"]] as const) {
        await execFileAsync("/usr/bin/ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=32x32:d=0.1`, "-pix_fmt", "yuv420p", path]);
      }

      const movie = await composeMovie([new Uint8Array(await readFile(first)), new Uint8Array(await readFile(second))]);

      expect(movie.byteLength).toBeGreaterThan(100);
      expect(Buffer.from(movie.subarray(4, 8)).toString()).toBe("ftyp");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
