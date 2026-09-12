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
    const mp4 = new Uint8Array([
      0, 0, 0, 12,
      0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d,
    ]);
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "interaction-1",
        steps: [
          { content: [{ type: "text", data: "ignored" }] },
          { content: [{ type: "video", data: Buffer.from(mp4).toString("base64") }] },
        ],
      }), { status: 200 })) as typeof fetch;

    const result = await new GeminiVideoGenerator().generateScene({
      prompt: "A single continuous cinematic shot.",
      duration: 5,
      referenceImageUrls: ["https://storage.example.com/photo.jpg"],
    });

    expect(result).toEqual({ providerJobId: "interaction-1", videoData: mp4 });
    const [, request] = vi.mocked(global.fetch).mock.calls[1];
    expect(request).toMatchObject({ method: "POST", headers: expect.objectContaining({ "x-goog-api-key": "test-key" }) });
    const body = JSON.parse((request as RequestInit).body as string);
    expect(body).toMatchObject({
      model: "gemini-omni-1.1-flash",
      response_format: { type: "video", aspect_ratio: "16:9", resolution: "720p" },
    });
    expect(body.input.at(-1)).toEqual({
      type: "text",
      text: expect.stringContaining("exactly 5 seconds long"),
    });
  });

  it("rejects when Gemini does not return video data", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "interaction-1",
      steps: [{ content: [{ type: "text", data: "not-video-data" }] }],
    }), { status: 200 })) as typeof fetch;

    await expect(new GeminiVideoGenerator().generateScene({ prompt: "scene", duration: 5, referenceImageUrls: [] })).rejects.toThrow("Gemini から動画データが返されませんでした");
  });

  it("Base64として復号できてもMP4ではない動画データを拒否する", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "interaction-1",
      steps: [{ content: [{ type: "video", data: "AQIDBAUGBwgJCgsM" }] }],
    }), { status: 200 })) as typeof fetch;

    await expect(
      new GeminiVideoGenerator().generateScene({
        prompt: "scene",
        duration: 5,
        referenceImageUrls: [],
      }),
    ).rejects.toThrow("Gemini から有効なMP4動画が返されませんでした");
  });

  it("画像ではない参照ファイルを拒否する", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(
      new Response("not an image", {
        headers: { "content-type": "text/html" },
      }),
    ) as typeof fetch;

    await expect(
      new GeminiVideoGenerator().generateScene({
        prompt: "scene",
        duration: 5,
        referenceImageUrls: ["https://storage.example.com/not-image"],
      }),
    ).rejects.toThrow("参照ファイルが画像ではありません");
  });

  it("10MBを超える参照画像をダウンロード前に拒否する", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(10 * 1024 * 1024 + 1),
        },
      }),
    ) as typeof fetch;

    await expect(
      new GeminiVideoGenerator().generateScene({
        prompt: "scene",
        duration: 5,
        referenceImageUrls: ["https://storage.example.com/large.jpg"],
      }),
    ).rejects.toThrow("参照画像が大きすぎます");
  });
});
