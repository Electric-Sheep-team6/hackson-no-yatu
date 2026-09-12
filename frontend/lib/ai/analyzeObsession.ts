import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { generateGeminiStructured } from "./gemini";
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
  evidence: { sourceType: "diary" | "photo"; summary: string }[];
  visualMotifs: string[];
};

const MAX_DIARY_CHARS = 50_000;
const MAX_TEXT_IMAGES = 26;
const ANALYSIS_INSTRUCTIONS = "あなたは個人の記録から偏愛を見つける編集者です。与えられた日記と写真だけを根拠に、日本語で分析してください。写真の内容が不確かな場合は断定せず、根拠には入力に実在する情報だけを書いてください。";

const obsessionSchema = z.object({
  title: z.string().min(1).max(80),
  reason: z.string().min(1).max(500),
  keywords: z.array(z.string()).min(1).max(8),
  emotion: z.array(z.string()).min(1).max(5),
  evidence: z.array(z.object({
    sourceType: z.enum(["diary", "photo"]),
    summary: z.string().min(1).max(300),
  })).min(1).max(8),
  visualMotifs: z.array(z.string()).max(8),
});

const obsessionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "reason", "keywords", "emotion", "evidence", "visualMotifs"],
  properties: {
    title: { type: "string" },
    reason: { type: "string" },
    keywords: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
    emotion: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
    evidence: {
      type: "array", minItems: 1, maxItems: 8,
      items: {
        type: "object", additionalProperties: false, required: ["sourceType", "summary"],
        properties: {
          sourceType: { type: "string", enum: ["diary", "photo"] },
          summary: { type: "string" },
        },
      },
    },
    visualMotifs: { type: "array", maxItems: 8, items: { type: "string" } },
  },
};

function truncateDiaryTexts(texts: string[]): string[] {
  return texts.reduce<{ values: string[]; remaining: number }>((state, text) => {
    if (state.remaining <= 0) return state;
    const excerpt = text.slice(0, state.remaining);
    return { values: [...state.values, excerpt], remaining: state.remaining - excerpt.length };
  }, { values: [], remaining: MAX_DIARY_CHARS }).values;
}

function getProvider(): "openai" | "gemini" {
  const provider = process.env.AI_TEXT_PROVIDER ?? "openai";
  if (provider !== "openai" && provider !== "gemini") throw new Error("AI_TEXT_PROVIDER の値が不正です");
  return provider;
}

async function analyzeWithOpenAI(prompt: string, photoUrls: string[]): Promise<ObsessionAnalysis> {
  const response = await createOpenAIClient().responses.parse({
    model: AI_TEXT_MODEL,
    store: false,
    reasoning: { effort: "low" },
    instructions: ANALYSIS_INSTRUCTIONS,
    input: [{ role: "user", content: [
      { type: "input_text", text: prompt },
      ...photoUrls.map((imageUrl) => ({ type: "input_image" as const, image_url: imageUrl, detail: "low" as const })),
    ] }],
    text: { format: zodTextFormat(obsessionSchema, "obsession_analysis") },
  });
  if (!response.output_parsed) throw new Error("偏愛分析の結果を読み取れませんでした");
  return obsessionSchema.parse(response.output_parsed);
}

export async function analyzeObsession(input: AnalyzeObsessionInput): Promise<ObsessionAnalysis> {
  const diaryTexts = truncateDiaryTexts(input.diaryTexts);
  const prompt = `日記:\n${diaryTexts.map((text, index) => `${index + 1}. ${text}`).join("\n") || "なし"}`;
  const photoUrls = input.photoUrls.slice(0, MAX_TEXT_IMAGES);
  if (getProvider() === "gemini") {
    return generateGeminiStructured(ANALYSIS_INSTRUCTIONS, prompt, photoUrls, obsessionJsonSchema, obsessionSchema);
  }
  return analyzeWithOpenAI(prompt, photoUrls);
}
