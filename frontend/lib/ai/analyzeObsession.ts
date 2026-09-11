import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { AI_TEXT_MODEL, createOpenAIClient } from "./openai";

export type AnalyzeObsessionInput = {
  diaryTexts: string[];
  photoUrls: string[];
};

export type ObsessionAnalysis = {
  title: string;
  reason: string;
  keywords: string[];
  emotion: string[];
  evidence: {
    sourceType: "diary" | "photo";
    summary: string;
  }[];
  visualMotifs: string[];
};

const obsessionSchema = z.object({
  title: z.string().min(1).max(80),
  reason: z.string().min(1).max(500),
  keywords: z.array(z.string()).min(1).max(8),
  emotion: z.array(z.string()).min(1).max(5),
  evidence: z.array(z.object({ sourceType: z.enum(["diary", "photo"]), summary: z.string().min(1).max(300) })).min(1).max(8),
  visualMotifs: z.array(z.string()).max(8),
});

export async function analyzeObsession(
  input: AnalyzeObsessionInput,
): Promise<ObsessionAnalysis> {
  let remainingDiaryChars = 50_000;
  const diaryTexts = input.diaryTexts.flatMap((text) => {
    if (remainingDiaryChars <= 0) return [];
    const excerpt = text.slice(0, remainingDiaryChars);
    remainingDiaryChars -= excerpt.length;
    return [excerpt];
  });
  const response = await createOpenAIClient().responses.parse({
    model: AI_TEXT_MODEL,
    store: false,
    reasoning: { effort: "low" },
    instructions: "あなたは個人の記録から偏愛を見つける編集者です。与えられた日記と写真だけを根拠に、日本語で分析してください。写真の内容が不確かな場合は断定せず、根拠には入力に実在する情報だけを書いてください。",
    input: [{ role: "user", content: [
      { type: "input_text", text: `日記:\n${diaryTexts.map((text, index) => `${index + 1}. ${text}`).join("\n") || "なし"}` },
      ...input.photoUrls.slice(0, 12).map((imageUrl) => ({ type: "input_image" as const, image_url: imageUrl, detail: "low" as const })),
    ] }],
    text: { format: zodTextFormat(obsessionSchema, "obsession_analysis") },
  });
  if (!response.output_parsed) throw new Error("偏愛分析の結果を読み取れませんでした");
  return response.output_parsed;
}
