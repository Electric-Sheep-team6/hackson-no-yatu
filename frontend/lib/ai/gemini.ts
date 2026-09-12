import { z } from "zod";

import { loadReferenceImage } from "./referenceImage";

export const GEMINI_TEXT_MODEL = "gemini-3.8-flash";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_TEXT_TIMEOUT_MS = 60_000;
const MAX_TEXT_IMAGES = 12;
const GEMINI_THINKING_LEVEL = "MINIMAL";

type JsonSchema = Record<string, unknown>;

const geminiResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }),
  })).min(1),
});

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return apiKey;
}

async function createParts(prompt: string, imageUrls: string[]) {
  const images = await Promise.all(imageUrls.slice(0, MAX_TEXT_IMAGES).map(loadReferenceImage));
  return [
    { text: prompt },
    ...images.map(({ data, mimeType }) => ({ inlineData: { data, mimeType } })),
  ];
}

async function requestStructuredText(
  instructions: string,
  prompt: string,
  imageUrls: string[],
  responseJsonSchema: JsonSchema,
): Promise<string> {
  const response = await fetch(`${GEMINI_API_BASE_URL}/models/${GEMINI_TEXT_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": getApiKey() },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: "user", parts: await createParts(prompt, imageUrls) }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema,
        thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
      },
    }),
    signal: AbortSignal.timeout(GEMINI_TEXT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Gemini テキスト生成に失敗しました");
  const parsed = geminiResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Gemini の応答を読み取れませんでした");
  const text = parsed.data.candidates[0].content.parts.map((part) => part.text ?? "").join("");
  if (!text) throw new Error("Gemini の応答を読み取れませんでした");
  return text;
}

export async function generateGeminiStructured<T>(
  instructions: string,
  prompt: string,
  imageUrls: string[],
  responseJsonSchema: JsonSchema,
  schema: z.ZodType<T>,
): Promise<T> {
  const text = await requestStructuredText(instructions, prompt, imageUrls, responseJsonSchema);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Gemini の構造化出力を解析できませんでした");
  }
  return schema.parse(value);
}
