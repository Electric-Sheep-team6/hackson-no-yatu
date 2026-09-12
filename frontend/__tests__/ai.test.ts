import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const responsesParse = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/openai", () => ({
  AI_TEXT_MODEL: "gpt-5.6-terra",
  createOpenAIClient: () => ({ responses: { parse: responsesParse } }),
}));

import { analyzeObsession } from "@/lib/ai/analyzeObsession";
import { generateMovieScript } from "@/lib/ai/generateMovieScript";

const originalFetch = global.fetch;
const analysis = {
  title: "雨上がりの帰り道",
  reason: "帰宅時の雨上がりを何度も記録しているためです。",
  keywords: ["雨", "帰り道"],
  emotion: ["安心"],
  evidence: [{ sourceType: "diary" as const, summary: "雨上がりの駅について書かれている" }],
  visualMotifs: ["濡れたアスファルト"],
};

const scenes = Array.from({ length: 3 }, (_, index) => ({
  order: index + 1,
  source: "駅前",
  duration: 8,
  narration: "水たまりが光る。",
  videoPrompt: "Pure black background, centered subject, single continuous shot, no scene transitions.",
  referencePhotoUrls: ["https://example.com/1.jpg"],
}));

const movie = {
  title: "雨のあと",
  logline: "帰り道に見つけた静かな安心。",
  synopsis: "雨上がりの街を歩く短編映画です。",
  visualStyle: "high contrast hologram",
  bgm: "quiet piano",
  scenes,
};

function geminiResponse(value: unknown): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
  }), { status: 200 });
}

describe("AI generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it("未設定時はOpenAIで日記と最大12枚の写真を分析する", async () => {
    responsesParse.mockResolvedValue({ output_parsed: analysis });
    const photoUrls = Array.from({ length: 13 }, (_, index) => `https://example.com/${index}.jpg`);

    await expect(analyzeObsession({ diaryTexts: ["駅まで歩いた"], photoUrls })).resolves.toEqual(analysis);

    const request = responsesParse.mock.calls[0][0];
    expect(request).toMatchObject({ model: "gpt-5.6-terra", store: false, reasoning: { effort: "low" } });
    expect(request.input[0].content.filter((item: { type: string }) => item.type === "input_image")).toHaveLength(12);
    expect(request.text.format.type).toBe("json_schema");
  });

  it("AI_TEXT_PROVIDER=geminiならGeminiのstructured outputを使う", async () => {
    vi.stubEnv("AI_TEXT_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(geminiResponse(analysis)) as typeof fetch;

    await expect(analyzeObsession({ diaryTexts: ["駅まで歩いた"], photoUrls: [] })).resolves.toEqual(analysis);

    expect(responsesParse).not.toHaveBeenCalled();
    const [url, request] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    const body = JSON.parse((request as RequestInit).body as string);
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    });
    expect(body.generationConfig.responseJsonSchema).toBeDefined();
  });

  it("Gemini出力がzodスキーマ違反なら拒否する", async () => {
    vi.stubEnv("AI_TEXT_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(geminiResponse({ ...analysis, title: "" })) as typeof fetch;

    await expect(analyzeObsession({ diaryTexts: ["記録"], photoUrls: [] })).rejects.toThrow();
  });

  it("偏愛分析へ送る日記本文を合計5万文字に制限する", async () => {
    responsesParse.mockResolvedValue({ output_parsed: analysis });
    await analyzeObsession({ diaryTexts: ["あ".repeat(50_000), "送信されない日記"], photoUrls: [] });
    const inputText = responsesParse.mock.calls[0][0].input[0].content[0].text as string;
    expect(inputText).not.toContain("送信されない日記");
    expect(inputText.match(/あ/g)).toHaveLength(50_000);
  });

  it("OpenAIでホログラム向けstructured movie scriptを生成する", async () => {
    responsesParse.mockResolvedValue({ output_parsed: movie });
    const result = await generateMovieScript({ obsession: analysis, photoUrls: ["https://example.com/1.jpg"] });

    const request = responsesParse.mock.calls[0][0];
    expect(request).toMatchObject({ model: "gpt-5.6-terra", store: false, reasoning: { effort: "medium" } });
    expect(request.instructions).toContain("pure black background");
    expect(request.instructions).toContain("no on-screen text");
    expect(request.instructions).toContain("camera movement must never move the subject away from the center");
    expect(request.instructions).toContain("single continuous shot");
    expect(result.scenes[0].videoPrompt).toContain("Pure black background");
    expect(result.scenes[0].videoPrompt).toContain("No scene transitions");
  });

  it("Geminiでも同じ映画構成スキーマを再検証する", async () => {
    vi.stubEnv("AI_TEXT_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    global.fetch = vi.fn().mockResolvedValue(geminiResponse(movie)) as typeof fetch;

    const result = await generateMovieScript({ obsession: analysis, photoUrls: [] });
    expect(responsesParse).not.toHaveBeenCalled();
    expect(result.scenes).toHaveLength(3);
    expect(result.scenes.every((scene) => scene.videoPrompt.includes("subject away from the center"))).toBe(true);
  });
});
