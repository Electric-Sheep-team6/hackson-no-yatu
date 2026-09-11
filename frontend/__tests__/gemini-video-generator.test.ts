import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiVideoGenerator } from "@/lib/ai/video/geminiVideoGenerator";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("GeminiVideoGenerator", () => {
  it("sends private reference images to Gemini and decodes the returned MP4", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "interaction-1", output_video: { data: "AQID" } }), { status: 200 })) as typeof fetch;

    const result = await new GeminiVideoGenerator().generateScene({
      prompt: "A single continuous cinematic shot.",
      duration: 5,
      referenceImageUrls: ["https://storage.example.com/photo.jpg"],
    });

    expect(result).toEqual({ providerJobId: "interaction-1", videoData: new Uint8Array([1, 2, 3]) });
    const [, request] = vi.mocked(global.fetch).mock.calls[1];
    expect(request).toMatchObject({ method: "POST", headers: expect.objectContaining({ "x-goog-api-key": "test-key" }) });
    expect(JSON.parse((request as RequestInit).body as string)).toMatchObject({
      model: "gemini-omni-1.1-flash",
      response_format: { type: "video", aspect_ratio: "16:9", resolution: "720p" },
    });
  });

  it("rejects when Gemini does not return video data", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "interaction-1" }), { status: 200 })) as typeof fetch;

    await expect(new GeminiVideoGenerator().generateScene({ prompt: "scene", duration: 5, referenceImageUrls: [] })).rejects.toThrow("Gemini から動画データが返されませんでした");
  });
});
