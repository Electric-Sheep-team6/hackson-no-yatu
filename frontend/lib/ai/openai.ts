import OpenAI from "openai";

import { TEXT_GENERATION_MAX_RETRIES, TEXT_GENERATION_TIMEOUT_MS } from "./timeouts";

export const AI_TEXT_MODEL = "gpt-5.6-terra";

export function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey, timeout: TEXT_GENERATION_TIMEOUT_MS, maxRetries: TEXT_GENERATION_MAX_RETRIES });
}
