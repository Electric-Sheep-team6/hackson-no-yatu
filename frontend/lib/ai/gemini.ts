import { z } from "zod";

import { ApiError } from "../apiError";

import { loadReferenceImage } from "./referenceImage";

import { TEXT_GENERATION_TIMEOUT_MS } from "./timeouts";

export const GEMINI_TEXT_MODEL = "gemini-3.8-flash";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_TEXT_IMAGES = 26;
// 構成・素材選択の品質を優先し、Gemini 3.8 Flash の思考量を一段上げる。
const GEMINI_THINKING_LEVEL = "MEDIUM";

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
    signal: AbortSignal.timeout(TEXT_GENERATION_TIMEOUT_MS),
  });
  if (!response.ok) {
    const providerError = await response.json().catch(() => null) as {
      error?: { status?: string; message?: string };
    } | null;
    const providerStatus = providerError?.error?.status ?? null;
    const providerMessage = providerError?.error?.message ?? "";
    console.error(JSON.stringify({
      stage: "gemini_text",
      status: response.status,
      providerStatus,
      providerMessage: providerMessage.slice(0, 500),
    }));
    // Vercel Hobby の300秒予算(timeouts.tsのコメント参照)を守るため、ここでは
    // 再試行せず1回で確定させる。その代わり、利用者・運用者が次に何をすべきか
    // 分かるようエラー種別だけは判別してメッセージを出し分ける。
    const isQuotaExhausted = providerStatus === "RESOURCE_EXHAUSTED"
      || providerMessage.includes("prepayment credits");
    const message = isQuotaExhausted
      ? "AIサービスの利用上限（課金設定）に達しています。しばらくしてから再度お試しいただくか、管理者にご連絡ください。"
      : "AIサービスが混み合っています。しばらくしてからもう一度お試しください。";
    throw new ApiError(503, "upstream_unavailable", message);
  }
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
