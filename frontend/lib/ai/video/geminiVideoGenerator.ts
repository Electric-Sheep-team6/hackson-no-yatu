import type { GenerateSceneInput, GenerateSceneResult, VideoGenerator } from "./VideoGenerator";

const GEMINI_MODEL = "gemini-omni-1.1-flash";
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

type GeminiInteraction = { id?: string; output_video?: { data?: string }; error?: { message?: string } };

async function toImageInput(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("参照画像を取得できませんでした");
  return {
    type: "image" as const,
    data: Buffer.from(await response.arrayBuffer()).toString("base64"),
    mime_type: response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg",
  };
}

export class GeminiVideoGenerator implements VideoGenerator {
  async generateScene(input: GenerateSceneInput): Promise<GenerateSceneResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    const images = await Promise.all(input.referenceImageUrls.slice(0, 3).map(toImageInput));
    const response = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: [...images, { type: "text", text: input.prompt }],
        response_format: { type: "video", aspect_ratio: "16:9", resolution: "720p" },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const interaction = await response.json() as GeminiInteraction;
    if (!response.ok) throw new Error(interaction.error?.message ?? "Gemini 動画生成に失敗しました");
    if (!interaction.id || !interaction.output_video?.data) throw new Error("Gemini から動画データが返されませんでした");
    return { providerJobId: interaction.id, videoData: new Uint8Array(Buffer.from(interaction.output_video.data, "base64")) };
  }
}

export const geminiVideoGenerator = new GeminiVideoGenerator();
