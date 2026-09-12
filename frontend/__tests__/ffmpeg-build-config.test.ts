import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("FFmpeg build configuration", () => {
  it("rebuilds and verifies ffmpeg-static before creating the deployment bundle", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.build).toContain("npm rebuild ffmpeg-static");
    expect(packageJson.scripts.build).toContain("scripts/verify-ffmpeg.mjs");
  });
});
