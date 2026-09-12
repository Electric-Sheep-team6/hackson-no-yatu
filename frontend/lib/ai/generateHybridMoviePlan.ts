import { z } from "zod";

import type { ObsessionAnalysis } from "./analyzeObsession";
import { generateGeminiStructured } from "./gemini";

export const MEMORY_DURATION_SECONDS = 42;
export const AI_DURATION_SECONDS = 14;
export const AI_GENERATION_DURATION_SECONDS = 10;
export const EDITORIAL_BLACK_DURATION_SECONDS = 2 + 5 * 0.5;
export const MEMORY_TIMELINE_DURATION_SECONDS = MEMORY_DURATION_SECONDS + EDITORIAL_BLACK_DURATION_SECONDS;
export const HYBRID_DURATION_SECONDS = MEMORY_TIMELINE_DURATION_SECONDS + AI_DURATION_SECONDS;

const MAX_PHOTOS = 26;
const MAX_VIDEO_PROMPT_CHARACTERS = 3_000;

const PRODUCTION_HERO_PROMPT = `
FINAL PRODUCTION RULES (these override any conflicting wording above): Input image 1 is the exact object for shot 1 and input image 2 is the exact object for shot 2. Create exactly two grounded live-action studio turntable shots with one clean hard cut near 5 seconds; never morph or dissolve. In each shot the corresponding rigid object rotates slowly by about 120 degrees while the camera stays locked. Preserve the reference object's geometry, proportions, material, color, surface marks, and count with no additions or substitutions. Make rotation, contact shadow, reflections, and inertia obey real-world physics. Shoot as if captured on an ARRI Alexa 35 with a Cooke 50mm anamorphic lens, restrained natural motion blur, practical soft-box lighting, fine 35mm grain, subtle halation, deep detailed blacks, and a restrained theatrical grade. No people, hands, faces, bodies, silhouettes, crowds, creatures, text, logos, UI, labels, excessive sparks, floating particles, impossible motion, warped geometry, liquid morphing, glossy CGI, or generic AI fantasy imagery.`;

const hybridMoviePlanSchema = z.object({
  title: z.string().min(1).max(15),
  logline: z.string().min(1).max(40),
  synopsis: z.string().min(1).max(1_000),
  photoOrder: z.array(z.number().int().min(1).max(MAX_PHOTOS)).max(MAX_PHOTOS),
  heroPrompt: z.string().min(1).max(2_000),
  motifs: z.array(z.object({
    name: z.string().min(1).max(20),
    count: z.number().int().min(1).max(MAX_PHOTOS),
    evidencePhotoNumbers: z.array(z.number().int().min(1).max(MAX_PHOTOS)).min(1).max(MAX_PHOTOS),
    objectDescription: z.string().min(1).max(300),
    imagePrompt: z.string().min(1).max(1_200),
  })).length(2),
  chapterLines: z.array(z.string().min(1).max(30)).min(3).max(3),
});

const hybridMoviePlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "logline",
    "synopsis",
    "photoOrder",
    "heroPrompt",
    "motifs",
    "chapterLines",
  ],
  properties: {
    title: { type: "string" },
    logline: { type: "string" },
    synopsis: { type: "string" },
    photoOrder: {
      type: "array",
      maxItems: MAX_PHOTOS,
      items: { type: "integer", minimum: 1, maximum: MAX_PHOTOS },
    },
    heroPrompt: { type: "string" },
    motifs: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "count", "evidencePhotoNumbers", "objectDescription", "imagePrompt"],
        properties: {
          name: { type: "string" },
          count: { type: "integer", minimum: 1, maximum: MAX_PHOTOS },
          evidencePhotoNumbers: {
            type: "array",
            minItems: 1,
            maxItems: MAX_PHOTOS,
            items: { type: "integer", minimum: 1, maximum: MAX_PHOTOS },
          },
          objectDescription: { type: "string" },
          imagePrompt: { type: "string" },
        },
      },
    },
    chapterLines: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string" },
    },
  },
} as const;

const INSTRUCTIONS = `あなたは実在する記録を映画予告編へ編集する構成作家です。
入力画像は添付順に P01, P02 ... と番号が付いています。URLは出力せず、必ず番号だけで参照してください。
photoOrder は全番号をちょうど1回ずつ使い、物語として効果的な順序を返してください。同じ番号を反復せず、似た構図の写真は隣接させないでください。欠落や重複はサーバー側でも補正されます。
motifs は、人物そのものを除き、異なる写真に明確に写る具体的な物体・道具・活動の対象を全26枚から数え、出現写真数が最も多いものと2番目に多いものを順位順に2件だけ返してください。countは推測せず evidencePhotoNumbers の重複なし件数と一致させてください。抽象概念や色、服、人物、顔は対象外です。imagePrompt は英語で、その物体だけを忠実な比率で中央に置いた高品質な1:1実写商品写真を作る指示にし、暗い無地背景、全体が画面内、文字・ロゴ・人物なしを必須にしてください。
heroPrompt は英語で、motifs[0]を0-5秒、motifs[1]を5-10秒に割り当て、各オブジェクトが暗いスタジオのターンテーブル上でゆっくり約120度回転する2つの実写的ショットを約5秒地点のハードカットで設計してください。完成時は14秒へ緩やかに速度調整されます。形状・寸法・表面・影を参照画像から変えず、文字、字幕、ロゴ、人物、手、顔、人影、変形、浮遊、過剰な粒子を禁止してください。
chapterLines は説明文ではなく、予告編で一瞬だけ出る短く強い日本語を3本にしてください。
titleは15文字以内、loglineは40文字以内を厳守してください。`;

export type HybridMoviePlan = z.infer<typeof hybridMoviePlanSchema>;

export function buildProductionHeroPrompt(prompt: string): string {
  const baseLimit = MAX_VIDEO_PROMPT_CHARACTERS - PRODUCTION_HERO_PROMPT.length;
  return `${prompt.slice(0, baseLimit)}${PRODUCTION_HERO_PROMPT}`;
}

function uniqueValidNumbers(numbers: number[], photoCount: number): number[] {
  return [...new Set(numbers.filter((value) => value >= 1 && value <= photoCount))];
}

/** AIの並びを尊重しつつ、実写真を一枚も捨てずに全件使う。 */
export function normalizeHybridMoviePlan(
  plan: HybridMoviePlan,
  photoCount: number,
): HybridMoviePlan {
  const selected = uniqueValidNumbers(plan.photoOrder, photoCount);
  const missing = Array.from({ length: photoCount }, (_, index) => index + 1)
    .filter((number) => !selected.includes(number));

  const motifs = plan.motifs.map((motif) => {
    const evidencePhotoNumbers = uniqueValidNumbers(motif.evidencePhotoNumbers, photoCount);
    if (evidencePhotoNumbers.length === 0) {
      throw new Error(`偏愛モチーフ「${motif.name}」に根拠写真がありません`);
    }
    return { ...motif, count: evidencePhotoNumbers.length, evidencePhotoNumbers };
  }).toSorted((a, b) => b.count - a.count);
  if (motifs[0].name === motifs[1].name) throw new Error("偏愛モチーフが重複しています");

  return hybridMoviePlanSchema.parse({
    ...plan,
    photoOrder: [...selected, ...missing],
    motifs,
  });
}

export async function generateHybridMoviePlan(input: {
  obsession: ObsessionAnalysis;
  photoUrls: string[];
}): Promise<HybridMoviePlan> {
  const photoUrls = input.photoUrls.slice(0, MAX_PHOTOS);
  const prompt = [
    `偏愛分析:\n${JSON.stringify(input.obsession)}`,
    `添付写真数: ${photoUrls.length}。添付順を P01〜P${String(photoUrls.length).padStart(2, "0")} として扱ってください。`,
  ].join("\n\n");
  const generated = await generateGeminiStructured(
    INSTRUCTIONS,
    prompt,
    photoUrls,
    hybridMoviePlanJsonSchema,
    hybridMoviePlanSchema,
  );
  return normalizeHybridMoviePlan(generated, photoUrls.length);
}
