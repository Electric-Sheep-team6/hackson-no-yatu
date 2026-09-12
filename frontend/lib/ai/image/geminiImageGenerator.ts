import { z } from "zod";

import type { HybridMoviePlan } from "../generateHybridMoviePlan";
import { IMAGE_GENERATION_TIMEOUT_MS } from "../timeouts";

export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

const imageContentSchema = z.object({
  type: z.literal("image"),
  data: z.string().min(1),
  mime_type: z.string().startsWith("image/").optional(),
});

const interactionSchema = z.object({
  id: z.string().min(1).optional(),
  created: z.union([z.string(), z.number()]).optional(),
  steps: z.array(z.unknown()),
});

export type GeneratedMotifImage = {
  providerJobId: string;
  data: Uint8Array;
  mimeType: string;
};

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return apiKey;
}

export function buildMotifImagePrompt(motif: HybridMoviePlan["motifs"][number]): string {
  return [
    "Photorealistic-natural product reference image for a cinematic turntable shot.",
    `Object name: ${motif.name}.`,
    `Observed form: ${motif.objectDescription}.`,
    motif.imagePrompt,
    "Show exactly one complete object, rigid and stationary, centered in a three-quarter view on a matte charcoal turntable against a seamless near-black studio background.",
    "Preserve believable real-world dimensions, construction, materials, surface wear, contact shadow, and perspective. Soft large-area key light, subtle rim light, neutral white balance, 50mm lens, crisp 2K photographic detail.",
    "No people, hands, faces, bodies, silhouettes, extra objects, scenery, smoke, active flame, sparks, text, letters, numbers, logos, labels, watermark, frame, collage, illustration, 3D render, or CGI look.",
  ].join(" ");
}

function findLastImage(steps: unknown[]): z.infer<typeof imageContentSchema> | undefined {
  const images = steps.flatMap((step) => {
    if (!step || typeof step !== "object") return [];
    const value = step as Record<string, unknown>;
    return value.type === "model_output" && Array.isArray(value.content)
      ? value.content
      : [];
  }).map((content) => imageContentSchema.safeParse(content))
    .filter((result) => result.success)
    .map((result) => result.data);
  return images.at(-1);
}

export async function generateGeminiMotifImage(
  motif: HybridMoviePlan["motifs"][number],
): Promise<GeneratedMotifImage> {
  const apiKey = getApiKey();
  const response = await fetch(INTERACTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model: GEMINI_IMAGE_MODEL,
      input: buildMotifImagePrompt(motif),
      response_format: { type: "image", aspect_ratio: "1:1", image_size: "2K" },
      store: false,
    }),
    signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const safeMessage = body.split(apiKey).join("[REDACTED]").slice(0, 500);
    throw Object.assign(new Error(`Gemini画像生成に失敗しました（HTTP ${response.status}）${safeMessage ? `: ${safeMessage}` : ""}`), {
      status: response.status,
    });
  }
  const parsed = interactionSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Gemini画像生成の応答を読み取れませんでした");
  const image = findLastImage(parsed.data.steps);
  if (!image) throw new Error("Geminiから偏愛オブジェクト画像が返されませんでした");
  return {
    providerJobId: parsed.data.id ?? `gemini-image-${parsed.data.created ?? "completed"}`,
    data: new Uint8Array(Buffer.from(image.data, "base64")),
    mimeType: image.mime_type ?? "image/jpeg",
  };
}
