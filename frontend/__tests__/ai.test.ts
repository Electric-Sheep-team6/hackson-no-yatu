import { beforeEach, describe, expect, it, vi } from "vitest";

const responsesParse = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/openai", () => ({
  AI_TEXT_MODEL: "gpt-5.6-terra",
  createOpenAIClient: () => ({ responses: { parse: responsesParse } }),
}));

import { analyzeObsession } from "@/lib/ai/analyzeObsession";
import { generateMovieScript } from "@/lib/ai/generateMovieScript";

const analysis = {
  title: "雨上がりの帰り道",
  reason: "帰宅時の雨上がりを何度も記録しているためです。",
  keywords: ["雨", "帰り道"],
  emotion: ["安心"],
  evidence: [{ sourceType: "diary" as const, summary: "雨上がりの駅について書かれている" }],
  visualMotifs: ["濡れたアスファルト"],
};

describe("AI generation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("analyzes diaries and at most 12 photos with non-stored structured output", async () => {
    responsesParse.mockResolvedValue({ output_parsed: analysis });
    const photoUrls = Array.from({ length: 13 }, (_, index) => `https://example.com/${index}.jpg`);

    await expect(analyzeObsession({ diaryTexts: ["駅まで歩いた"], photoUrls })).resolves.toEqual(analysis);

    expect(responsesParse).toHaveBeenCalledOnce();
    const request = responsesParse.mock.calls[0][0];
    expect(request).toMatchObject({ model: "gpt-5.6-terra", store: false, reasoning: { effort: "low" } });
    expect(request.input[0].content.filter((item: { type: string }) => item.type === "input_image")).toHaveLength(12);
    expect(request.text.format.type).toBe("json_schema");
  });

  it("fails safely when obsession analysis has no parseable result", async () => {
    responsesParse.mockResolvedValue({ output_parsed: null });

    await expect(analyzeObsession({ diaryTexts: ["記録"], photoUrls: [] })).rejects.toThrow("偏愛分析の結果を読み取れませんでした");
  });

  it("creates a structured movie script with medium reasoning", async () => {
    const movie = {
      title: "雨のあと",
      logline: "帰り道に見つけた静かな安心。",
      synopsis: "雨上がりの街を歩く短編映画です。",
      visualStyle: "soft blue cinematic light",
      bgm: "quiet piano",
      scenes: [{ order: 1, source: "駅前", duration: 5, narration: "水たまりが光る。", videoPrompt: "A single continuous cinematic shot, no scene transitions.", referencePhotoUrls: ["https://example.com/1.jpg"] }],
    };
    responsesParse.mockResolvedValue({ output_parsed: movie });

    await expect(generateMovieScript({ obsession: analysis, photoUrls: ["https://example.com/1.jpg"] })).resolves.toEqual(movie);

    const request = responsesParse.mock.calls[0][0];
    expect(request).toMatchObject({ model: "gpt-5.6-terra", store: false, reasoning: { effort: "medium" } });
    expect(request.input[0].content[0].text).toContain("雨上がりの帰り道");
    expect(request.text.format.type).toBe("json_schema");
  });
});
