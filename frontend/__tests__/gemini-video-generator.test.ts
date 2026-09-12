import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prepareHologramVideo = vi.hoisted(() => vi.fn(async (video: Uint8Array) => video));

vi.mock("@/lib/ai/video/prepareHologramVideo", () => ({ prepareHologramVideo }));

import { beginMovieImageCache } from "@/lib/ai/referenceImage";
import { GeminiVideoGenerator } from "@/lib/ai/video/geminiVideoGenerator";

const originalFetch = global.fetch;
const completedOperation = {
  name: "operations/video-1",
  done: true,
  response: {
    generateVideoResponse: {
      generatedSamples: [{ video: { encodedVideo: "AQID" } }],
    },
  },
};

function imageResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
}

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  prepareHologramVideo.mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GeminiVideoGenerator", () => {
  it("Veo LROへ参照画像と8秒指定を送り、返却動画を正方形化する", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify(completedOperation), { status: 200 })) as typeof fetch;

    const result = await new GeminiVideoGenerator().generateScene({
      prompt: "A centered subject on pure black.",
      duration: 5,
      referenceImageUrls: ["https://storage.example.com/photo.jpg"],
    });

    expect(result).toEqual({ providerJobId: "operations/video-1", videoData: new Uint8Array([1, 2, 3]) });
    const [url, request] = vi.mocked(global.fetch).mock.calls[1];
    expect(url).toContain("/models/veo-3.1-generate-preview:predictLongRunning");
    const body = JSON.parse((request as RequestInit).body as string);
    expect(body).toMatchObject({
      instances: [{ referenceImages: [{
        image: { bytesBase64Encoded: "AQID", mimeType: "image/jpeg" },
        referenceType: "ASSET",
      }] }],
      parameters: { sampleCount: 1, aspectRatio: "16:9", resolution: "720p", durationSeconds: 8 },
    });
    expect(prepareHologramVideo).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 5, 8);
  });

  it("未完了operationをポーリングして動画を取得する", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "operations/video-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completedOperation), { status: 200 })) as typeof fetch;

    const pending = new GeminiVideoGenerator().generateScene({
      prompt: "scene",
      duration: 5,
      referenceImageUrls: [],
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ providerJobId: "operations/video-1" });
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toContain("/v1beta/operations/video-1");
    const requestBody = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(requestBody.instances[0]).not.toHaveProperty("referenceImages");
    expect(requestBody.parameters.durationSeconds).toBe(6);
  });

  it("同じ映画生成内では同一URLを1回だけ取得する", async () => {
    beginMovieImageCache();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("https://storage.example.com")) return imageResponse();
      return new Response(JSON.stringify(completedOperation), { status: 200 });
    });
    global.fetch = fetchMock as typeof fetch;
    const generator = new GeminiVideoGenerator();
    const input = { prompt: "scene", duration: 8, referenceImageUrls: ["https://storage.example.com/same.jpg"] };

    await generator.generateScene(input);
    await generator.generateScene(input);

    const imageCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("https://storage.example.com"));
    expect(imageCalls).toHaveLength(1);
  });

  it("画像ではない参照ファイルを拒否する", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not an image", {
      headers: { "content-type": "text/html" },
    })) as typeof fetch;

    await expect(new GeminiVideoGenerator().generateScene({
      prompt: "scene",
      duration: 5,
      referenceImageUrls: ["https://storage.example.com/not-image"],
    })).rejects.toThrow("参照ファイルが画像ではありません");
  });

  it("10MBを超える参照画像をContent-Lengthで拒否する", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(10 * 1024 * 1024 + 1),
      },
    })) as typeof fetch;

    await expect(new GeminiVideoGenerator().generateScene({
      prompt: "scene",
      duration: 5,
      referenceImageUrls: ["https://storage.example.com/large.jpg"],
    })).rejects.toThrow("参照画像が大きすぎます");
  });

  it("Content-Lengthがなくても10MB超過時点で参照画像を拒否する", async () => {
    const chunk = new Uint8Array(6 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    global.fetch = vi.fn().mockResolvedValue(new Response(body, {
      headers: { "content-type": "image/jpeg" },
    })) as typeof fetch;

    await expect(new GeminiVideoGenerator().generateScene({
      prompt: "scene",
      duration: 5,
      referenceImageUrls: ["https://storage.example.com/streamed-large.jpg"],
    })).rejects.toThrow("参照画像が大きすぎます");
  });

  it("完了応答に動画がなければ拒否する", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: "operations/video-1",
      done: true,
      response: { generateVideoResponse: {} },
    }), { status: 200 })) as typeof fetch;

    await expect(new GeminiVideoGenerator().generateScene({
      prompt: "scene",
      duration: 5,
      referenceImageUrls: [],
    })).rejects.toThrow("Gemini から動画データが返されませんでした");
  });
});
