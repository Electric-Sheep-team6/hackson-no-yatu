import type { ObsessionAnalysis } from "./analyzeObsession";

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

const movieScriptSchema = z.object({
  title: z.string().min(1).max(100),
  logline: z.string().min(1).max(300),
  synopsis: z.string().min(1).max(1_000),
  visualStyle: z.string().min(1).max(300),
  bgm: z.string().min(1).max(300),
  scenes: z.array(z.object({
    order: z.number().int().min(1).max(5),
    source: z.string().min(1).max(200),
    duration: z.number().int().min(3).max(10),
    narration: z.string().min(1).max(300),
    videoPrompt: z.string().min(1).max(2_000),
    // OpenAI Structured Outputs does not accept JSON Schema's `uri` format.
    // Validate membership in the server instead, after parsing the response.
    referencePhotoUrls: z.array(z.string()).max(3),
  })).min(3).max(5),
});

export async function generateMovieScript(
  input: GenerateMovieScriptInput,
): Promise<MovieScript> {
  const response = await createOpenAIClient().responses.parse({
    model: AI_TEXT_MODEL,
    store: false,
    reasoning: { effort: "medium" },
    instructions: "あなたは短編映画の構成作家です。偏愛分析と参照写真だけを使い、日本語の映画構成を作ってください。scenes は時系列で3〜5個、各3〜10秒です。videoPrompt は英語で、被写体・場所・動作・構図・カメラ・光・色・音・禁止事項（single continuous shot, no scene transitions）を含めます。referencePhotoUrls には入力で渡された URL だけを入れてください。",
    input: [{ role: "user", content: [
      { type: "input_text", text: `偏愛分析:\n${JSON.stringify(input.obsession)}` },
      ...input.photoUrls.slice(0, 12).map((imageUrl) => ({ type: "input_image" as const, image_url: imageUrl, detail: "low" as const })),
    ] }],
    text: { format: zodTextFormat(movieScriptSchema, "movie_script") },
  });
  if (!response.output_parsed) throw new Error("映画構成の結果を読み取れませんでした");

  const allowedPhotoUrls = new Set(input.photoUrls);
  return {
    ...response.output_parsed,
    scenes: response.output_parsed.scenes.map((scene) => ({
      ...scene,
      referencePhotoUrls: scene.referencePhotoUrls.filter((url) =>
        allowedPhotoUrls.has(url),
      ),
    })),
  };
}
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { AI_TEXT_MODEL, createOpenAIClient } from "./openai";
