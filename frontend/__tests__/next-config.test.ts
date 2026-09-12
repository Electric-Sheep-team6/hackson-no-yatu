import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("Next.js output tracing", () => {
  it("includes the ffmpeg-static runtime binary in the movie route bundle", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/api/movies"]).toContain(
      "./node_modules/ffmpeg-static/**/*",
    );
  });
});
