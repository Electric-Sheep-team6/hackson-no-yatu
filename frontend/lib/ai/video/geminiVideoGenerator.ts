import { z } from "zod";

import {
  loadReferenceImage,
  type ReferenceImage,
} from "../referenceImage";
import { VIDEO_REQUEST_TIMEOUT_MS } from "../timeouts";
import { prepareHologramVideo } from "./prepareHologramVideo";
import type {
  GenerateSceneInput,
  GenerateSceneResult,
  VideoGenerator,
} from "./VideoGenerator";

const GEMINI_MODEL = "gemini-omni-1.1-flash";
const INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_REFERENCE_IMAGES = 3;

const FALLBACK_ERROR_MESSAGE =
  "Gemini 動画生成に失敗しました";
const REDACTED_VALUE = "[REDACTED]";

const videoContentSchema = z.object({
  type: z.literal("video").optional(),
  data: z.string().min(1),
});

const interactionSchema = z.object({
  id: z.string().min(1),
  output_video: videoContentSchema.optional(),
  steps: z.array(
    z.object({
      type: z.string(),
      content: z.array(z.unknown()).optional(),
    }),
  ).optional(),
});

const geminiErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
  }).optional(),
  message: z.string().optional(),
});

type GeminiInteraction =
  z.infer<typeof interactionSchema>;

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Gemini APIキーが設定されていません",
    );
  }

  return apiKey;
}

function toImageInput(image: ReferenceImage) {
  return {
    type: "image" as const,
    data: image.data,
    mime_type: image.mimeType,
  };
}

function buildTimedPrompt(
  prompt: string,
  duration: number,
): string {
  return `[0-${duration}s] ${prompt}`;
}

function findStepVideo(
  interaction: GeminiInteraction,
) {
  const content = interaction.steps
    ?.filter(
      (step) => step.type === "model_output",
    )
    .flatMap(
      (step) => step.content ?? [],
    )
    .findLast(
      (item) =>
        videoContentSchema.safeParse(item).success,
    );

  const parsed =
    videoContentSchema.safeParse(content);

  return parsed.success
    ? parsed.data
    : undefined;
}

function readVideoData(
  interaction: GeminiInteraction,
): Uint8Array {
  const video =
    interaction.output_video
    ?? findStepVideo(interaction);

  if (!video) {
    throw new Error(
      "Gemini から動画データが返されませんでした",
    );
  }

  return new Uint8Array(
    Buffer.from(video.data, "base64"),
  );
}

function replaceSecret(
  text: string,
  secret: string,
) {
  if (!secret) {
    return text;
  }

  return text.split(secret).join(REDACTED_VALUE);
}

function sanitizeErrorMessage(
  message: string,
  apiKey: string,
) {
  const withoutApiKey = replaceSecret(
    message,
    apiKey,
  );

  return replaceSecret(
    withoutApiKey,
    INTERACTIONS_URL,
  );
}

function parseGeminiErrorMessage(
  responseBody: string,
) {
  if (!responseBody.trim()) {
    return undefined;
  }

  try {
    const parsed =
      geminiErrorSchema.safeParse(
        JSON.parse(responseBody),
      );

    if (!parsed.success) {
      return undefined;
    }

    return (
      parsed.data.error?.message
      ?? parsed.data.message
    );
  } catch {
    return responseBody;
  }
}

async function readErrorResponseBody(
  response: Response,
) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function createGeminiHttpError(
  response: Response,
  apiKey: string,
) {
  const responseBody =
    await readErrorResponseBody(response);

  const providerMessage =
    parseGeminiErrorMessage(responseBody);

  const message = providerMessage
    ? sanitizeErrorMessage(
        providerMessage,
        apiKey,
      )
    : FALLBACK_ERROR_MESSAGE;

  return Object.assign(
    new Error(message),
    { status: response.status },
  );
}

export class GeminiVideoGenerator
implements VideoGenerator {
  async generateScene(
    input: GenerateSceneInput,
  ): Promise<GenerateSceneResult> {
    const references = await Promise.all(
      input.referenceImageUrls
        .slice(0, MAX_REFERENCE_IMAGES)
        .map(loadReferenceImage),
    );

    const apiKey = getApiKey();

    const response = await fetch(
      INTERACTIONS_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          input: [
            ...references.map(toImageInput),
            {
              type: "text",
              text: buildTimedPrompt(
                input.prompt,
                input.duration,
              ),
            },
          ],
          generation_config: {
            video_config: {
              task:
                references.length > 0
                  ? "reference_to_video"
                  : "text_to_video",
            },
          },
          response_format: {
            type: "video",
            aspect_ratio: "16:9",
            resolution: "720p",
          },
        }),
        signal: AbortSignal.timeout(
          VIDEO_REQUEST_TIMEOUT_MS,
        ),
      },
    );

    if (!response.ok) {
      throw await createGeminiHttpError(
        response,
        apiKey,
      );
    }

    const parsed =
      interactionSchema.safeParse(
        await response.json(),
      );

    if (!parsed.success) {
      throw new Error(
        "Gemini 動画生成の応答を読み取れませんでした",
      );
    }

    const videoData =
      await prepareHologramVideo(
        readVideoData(parsed.data),
      );

    return {
      providerJobId: parsed.data.id,
      videoData,
    };
  }
}

export const geminiVideoGenerator =
  new GeminiVideoGenerator();