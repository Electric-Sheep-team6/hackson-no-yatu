import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMotifImagePrompt,
  GEMINI_IMAGE_MODEL,
  generateGeminiMotifImage,
} from "@/lib/ai/image/geminiImageGenerator";

const motif = {
  name: "軽トラック",
  count: 4,
  evidencePhotoNumbers: [1, 3, 7, 9],
  objectDescription: "白い小型トラック、短い荷台、実用的な車体",
  imagePrompt: "A faithful Japanese white kei truck.",
};
const originalFetch = global.fetch;

beforeEach(() => vi.stubEnv("GEMINI_API_KEY", "test-key"));
afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("Gemini motif image generator", () => {
  it("上位モチーフを文字なしの単体2K商品写真として1回生成する", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      created: 123,
      steps: [{ type: "model_output", content: [
        { type: "image", data: "AQ==", mime_type: "image/jpeg", thought: true },
        { type: "image", data: "AgM=", mime_type: "image/jpeg" },
      ] }],
    }), { status: 200 })) as typeof fetch;

    await expect(generateGeminiMotifImage(motif)).resolves.toEqual({
      providerJobId: "gemini-image-123",
      data: new Uint8Array([2, 3]),
      mimeType: "image/jpeg",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const request = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({
      model: GEMINI_IMAGE_MODEL,
      response_format: { type: "image", aspect_ratio: "1:1", image_size: "2K" },
      store: false,
    });
    expect(body.input).toContain("軽トラック");
    expect(body.input).toContain("No people");
  });

  it("プロンプトで単体、実寸、文字禁止を固定する", () => {
    const prompt = buildMotifImagePrompt(motif);
    expect(prompt).toContain("exactly one complete object");
    expect(prompt).toContain("real-world dimensions");
    expect(prompt).toContain("No people");
    expect(prompt).toContain("text");
  });
});
