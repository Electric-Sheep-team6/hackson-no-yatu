import type { GenerateSceneInput, GenerateSceneResult, VideoGenerator } from "./VideoGenerator";

const GEMINI_MODEL = "gemini-omni-1.1-flash";
const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;

type GeminiInteraction = {
  id?: string;
  steps?: Array<{ content?: Array<{ type?: string; data?: string }> }>;
  error?: { message?: string };
};

async function readReferenceImage(response: Response): Promise<Buffer> {
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("参照画像が大きすぎます");
  }

  if (!response.body) throw new Error("参照画像を読み取れませんでした");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REFERENCE_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("参照画像が大きすぎます");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, totalBytes);
}

async function toImageInput(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("参照画像を取得できませんでした");
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("参照ファイルが画像ではありません");
  }
  const image = await readReferenceImage(response);
  return {
    type: "image" as const,
    data: image.toString("base64"),
    mime_type: contentType,
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
    const videoData = interaction.steps
      ?.flatMap((step) => step.content ?? [])
      .find((content) => content.type === "video")
      ?.data;
    if (!interaction.id || !videoData) throw new Error("Gemini から動画データが返されませんでした");
    return { providerJobId: interaction.id, videoData: new Uint8Array(Buffer.from(videoData, "base64")) };
  }
}

export const geminiVideoGenerator = new GeminiVideoGenerator();
