import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type { ObsessionAnalysis } from "./analyzeObsession";
import { generateGeminiStructured } from "./gemini";
import { AI_TEXT_MODEL, createOpenAIClient } from "./openai";
import { beginMovieImageCache } from "./referenceImage";

export type GenerateMovieScriptInput = {
  obsession: ObsessionAnalysis;
  photoUrls: string[];
};

export type MovieScript = {
  title: string;
  logline: string;
  synopsis: string;
  visualStyle: string;
  bgm: string;
  scenes: {
    order: number;
    source: string;
    duration: number;
    narration: string;
    videoPrompt: string;
    referencePhotoUrls: string[];
  }[];
};

const MAX_TEXT_IMAGES = 26;
const MAX_VIDEO_PROMPT_CHARS = 2_000;
const HOLOGRAM_PROMPT_REQUIREMENTS = " Pure black background. A single isolated subject centered in the frame. High contrast. Keep all important elements away from every screen edge and corner. No on-screen text, subtitles, captions, typography, or logos. Camera movement must never move the subject away from the center. Single continuous shot. No scene transitions.";
const SCRIPT_INSTRUCTIONS = `あなたはホログラムファン向け短編映画の構成作家です。偏愛分析と参照写真だけを使い、日本語の映画構成を作ってください。scenes は時系列で3〜5個、duration は3〜10秒です。referencePhotoUrls には入力で渡された URL だけを最大3件入れてください。
videoPrompt は英語で、先頭に付与される [0-{duration}s] のタイムコード内で完結する一続きの動作として、被写体・場所・動作・構図・カメラ・光・色・音を具体的に記述してください。videoPrompt 自体には別のタイムコードを入れないでください。すべてのシーンで次の要件を明記してください: pure black background; a single isolated subject centered in the frame; high contrast; keep all important elements away from every screen edge and corner; no on-screen text, subtitles, captions, typography, or logos; camera movement must never move the subject away from the center; single continuous shot; no scene transitions. 円形クロップ後も成立するよう、主被写体以外の装飾を増やさず、中央の安全領域だけを使ってください。
出力する title は15文字以内にしてください。出力する logline は40文字以内にしてください。予告編の画面上に描画するため、この文字数を厳守してください。`;

// title / logline の文字数上限は、予告編編集（ASS字幕の安全領域）が要求する値を
// zodスキーマで検証する。JSON Schema側（movieScriptJsonSchema）はGemini構造化出力の
// 型定義のみを担い、文字数上限はここでのzod検証に委ねる。
const movieScriptSchema = z.object({
  title: z.string().min(1).max(15),
  logline: z.string().min(1).max(40),
  synopsis: z.string().min(1).max(1_000),
  visualStyle: z.string().min(1).max(300),
  bgm: z.string().min(1).max(300),
  scenes: z.array(z.object({
    order: z.number().int().min(1).max(5),
    source: z.string().min(1).max(200),
    duration: z.number().int().min(3).max(10),
    narration: z.string().min(1).max(300),
    videoPrompt: z.string().min(1).max(2_000),
    referencePhotoUrls: z.array(z.string().url()).max(3),
  })).min(3).max(5),
});

const movieScriptJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["title", "logline", "synopsis", "visualStyle", "bgm", "scenes"],
  properties: {
    title: { type: "string" },
    logline: { type: "string" },
    synopsis: { type: "string" },
    visualStyle: { type: "string" },
    bgm: { type: "string" },
    scenes: {
      type: "array", minItems: 3, maxItems: 5,
      items: {
        type: "object", additionalProperties: false,
        required: ["order", "source", "duration", "narration", "videoPrompt", "referencePhotoUrls"],
        properties: {
          order: { type: "integer", minimum: 1, maximum: 5 },
          source: { type: "string" },
          duration: { type: "integer", minimum: 3, maximum: 10 },
          narration: { type: "string" },
          videoPrompt: { type: "string" },
          referencePhotoUrls: { type: "array", maxItems: 3, items: { type: "string" } },
        },
      },
    },
  },
};

function getProvider(): "openai" | "gemini" {
  const provider = process.env.AI_TEXT_PROVIDER ?? "openai";
  if (provider !== "openai" && provider !== "gemini") throw new Error("AI_TEXT_PROVIDER の値が不正です");
  return provider;
}

function enforceHologramPrompts(movie: MovieScript): MovieScript {
  const maxBaseLength = MAX_VIDEO_PROMPT_CHARS - HOLOGRAM_PROMPT_REQUIREMENTS.length;
  return movieScriptSchema.parse({
    ...movie,
    scenes: movie.scenes.map((scene) => ({
      ...scene,
      videoPrompt: `${scene.videoPrompt.slice(0, maxBaseLength)}${HOLOGRAM_PROMPT_REQUIREMENTS}`,
    })),
  });
}

async function generateWithOpenAI(prompt: string, photoUrls: string[]): Promise<MovieScript> {
  const response = await createOpenAIClient().responses.parse({
    model: AI_TEXT_MODEL,
    store: false,
    reasoning: { effort: "medium" },
    instructions: SCRIPT_INSTRUCTIONS,
    input: [{ role: "user", content: [
      { type: "input_text", text: prompt },
      ...photoUrls.map((imageUrl) => ({ type: "input_image" as const, image_url: imageUrl, detail: "low" as const })),
    ] }],
    text: { format: zodTextFormat(movieScriptSchema, "movie_script") },
  });
  if (!response.output_parsed) throw new Error("映画構成の結果を読み取れませんでした");
  return enforceHologramPrompts(movieScriptSchema.parse(response.output_parsed));
}

export async function generateMovieScript(input: GenerateMovieScriptInput): Promise<MovieScript> {
  beginMovieImageCache();
  const prompt = `偏愛分析:\n${JSON.stringify(input.obsession)}`;
  const photoUrls = input.photoUrls.slice(0, MAX_TEXT_IMAGES);
  if (getProvider() === "gemini") {
    const movie = await generateGeminiStructured(
      SCRIPT_INSTRUCTIONS, prompt, photoUrls, movieScriptJsonSchema, movieScriptSchema,
    );
    return enforceHologramPrompts(movie);
  }
  return generateWithOpenAI(prompt, photoUrls);
}
