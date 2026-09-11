import OpenAI from "openai";

export const AI_TEXT_MODEL = "gpt-5.6-terra";

export function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 });
}
