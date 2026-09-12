import type { ObsessionAnalysis } from "@/lib/ai/analyzeObsession";
import { AI_GENERATION_DURATION_SECONDS, buildProductionHeroPrompt, generateHybridMoviePlan, HYBRID_DURATION_SECONDS, type HybridMoviePlan } from "@/lib/ai/generateHybridMoviePlan";
import { generateGeminiMotifImage } from "@/lib/ai/image/geminiImageGenerator";
import { beginMovieImageCache, loadReferenceImage } from "@/lib/ai/referenceImage";
import { HYBRID_COMPOSE_TIMEOUT_MS, MEMORY_COMPOSE_TIMEOUT_MS } from "@/lib/ai/timeouts";
import { composeHybridMovie, composeMemoryMontage, type MemoryPhoto, type MemoryVideo } from "@/lib/ai/video/composeHybridMovie";
import { geminiVideoGenerator } from "@/lib/ai/video/geminiVideoGenerator";
import { createAdminClient } from "@/lib/supabase/admin";

export const SCENE_CONCURRENCY = 1;
export const MAX_SCENES = 1;

type AdminClient = ReturnType<typeof createAdminClient>;
type ErrorCategory = "timeout" | "rate_limit" | "server" | "input_blocked" | "other";
const MAX_MEMORY_VIDEO_BYTES = 25 * 1024 * 1024;

class GenerationStageError extends Error {
  constructor(readonly stageLabel: string, readonly category: ErrorCategory) {
    super(`${stageLabel}に失敗しました（${categoryLabel(category)}）`);
  }
}

function categoryLabel(category: ErrorCategory) {
  return { timeout: "タイムアウト", rate_limit: "レート制限", server: "外部サービスエラー", input_blocked: "入力ブロック", other: "その他" }[category];
}

function classifyError(error: unknown): ErrorCategory {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof value.status === "number" ? value.status : undefined;
  const searchable = `${value.name ?? ""} ${value.message ?? error ?? ""} ${value.code ?? ""}`.toLowerCase();
  if (status === 400 && /input blocked|safety violation|harmful content/.test(searchable)) return "input_blocked";
  if (status === 429 || /rate.?limit|quota|resource.*exhausted/.test(searchable)) return "rate_limit";
  if (/timeout|timed.?out|aborterror|etimedout/.test(searchable)) return "timeout";
  if ((status !== undefined && status >= 500) || /internal server|service unavailable|bad gateway|overloaded/.test(searchable)) return "server";
  return "other";
}

function logTiming(stage: string, movieId: string, startedAt: number) {
  console.log(JSON.stringify({ stage, ms: Date.now() - startedAt, movieId }));
}

async function updateMovie(admin: AdminClient, movieId: string, userId: string, values: Record<string, unknown>) {
  const { error } = await admin.from("movies").update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", movieId).eq("user_id", userId);
  if (error) throw error;
}

async function signedUrls(admin: AdminClient, bucket: "photos" | "videos", paths: string[]): Promise<string[]> {
  return Promise.all(paths.map(async (path) => {
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 3_600);
    if (error || !data) throw error ?? new Error(`${bucket}の署名URLを生成できませんでした`);
    return data.signedUrl;
  }));
}

async function loadMediaUrls(admin: AdminClient, userId: string) {
  const [photosResult, videosResult] = await Promise.all([
    admin.from("photos").select("storage_path").eq("user_id", userId).order("created_at", { ascending: false }).limit(26),
    admin.from("videos").select("storage_path").eq("user_id", userId).order("created_at", { ascending: false }).limit(4),
  ]);
  if (photosResult.error) throw photosResult.error;
  const videoRows = videosResult.error?.code === "42P01" ? [] : videosResult.data;
  if (videosResult.error && videosResult.error.code !== "42P01") throw videosResult.error;
  if (photosResult.data.length === 0) throw new Error("映画に使う写真がありません");
  const [photoUrls, videoUrls] = await Promise.all([
    signedUrls(admin, "photos", photosResult.data.map(({ storage_path }) => storage_path)),
    signedUrls(admin, "videos", (videoRows ?? []).map(({ storage_path }) => storage_path)),
  ]);
  return { photoUrls, videoUrls };
}

async function fetchVideo(url: string): Promise<MemoryVideo> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("記録動画を取得できませんでした");
  const mime = response.headers.get("content-type") ?? "";
  if (!mime.startsWith("video/")) throw new Error("記録動画の形式が不正です");
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_MEMORY_VIDEO_BYTES) throw new Error("記録動画は1本25MB以下にしてください");
  if (!response.body) throw new Error("記録動画を読み取れませんでした");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MEMORY_VIDEO_BYTES) {
      await reader.cancel();
      throw new Error("記録動画は1本25MB以下にしてください");
    }
    chunks.push(value);
  }
  return { data: new Uint8Array(Buffer.concat(chunks, total)) };
}

async function loadActualMedia(photoUrls: string[], videoUrls: string[], plan: HybridMoviePlan) {
  const orderedUrls = plan.photoOrder.map((number) => ({ number, url: photoUrls[number - 1] }))
    .filter((entry): entry is { number: number; url: string } => Boolean(entry.url));
  const [photos, videos] = await Promise.all([
    Promise.all(orderedUrls.map(async ({ number, url }): Promise<MemoryPhoto> => {
      const image = await loadReferenceImage(url);
      return { number, data: new Uint8Array(Buffer.from(image.data, "base64")) };
    })),
    Promise.all(videoUrls.slice(0, 4).map(fetchVideo)),
  ]);
  return { photos, videos };
}

async function uploadMovieAsset(admin: AdminClient, path: string, data: Uint8Array, contentType: string) {
  const { error } = await admin.storage.from("movies").upload(path, data, { contentType, upsert: true });
  if (error) throw error;
}

function imageExtension(mimeType: string): "png" | "jpg" {
  return mimeType === "image/png" ? "png" : "jpg";
}

async function generateAiSequence(
  admin: AdminClient,
  plan: HybridMoviePlan,
  userId: string,
  movieId: string,
) {
  const motifImages = await Promise.all(plan.motifs.map(generateGeminiMotifImage));
  const generatedMotifs = await Promise.all(motifImages.map(async (image, index) => {
    const motif = plan.motifs[index];
    const path = `${userId}/${movieId}/motifs/${index + 1}.${imageExtension(image.mimeType)}`;
    await uploadMovieAsset(admin, path, image.data, image.mimeType);
    return {
      name: motif.name,
      count: motif.count,
      evidencePhotoNumbers: motif.evidencePhotoNumbers,
      path,
      providerJobId: image.providerJobId,
    };
  }));
  const result = await geminiVideoGenerator.generateScene({
    prompt: buildProductionHeroPrompt(plan.heroPrompt),
    duration: AI_GENERATION_DURATION_SECONDS,
    referenceImageUrls: motifImages.map((image) =>
      `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
    ),
  });
  if (!result.videoData) throw new Error("Geminiから動画データが返されませんでした");
  const path = `${userId}/${movieId}/scenes/ai-symbolic.mp4`;
  await uploadMovieAsset(admin, path, result.videoData, "video/mp4");
  return { data: result.videoData, providerJobId: result.providerJobId, path, generatedMotifs };
}

async function completeMovieGeneration(admin: AdminClient, movieId: string, userId: string, obsession: ObsessionAnalysis) {
  const startedAt = Date.now();
  await updateMovie(admin, movieId, userId, { status: "analyzing" });
  const { photoUrls, videoUrls } = await loadMediaUrls(admin, userId);
  logTiming("analyzing", movieId, startedAt);

  const planStartedAt = Date.now();
  await updateMovie(admin, movieId, userId, { status: "generating" });
  const plan = await generateHybridMoviePlan({ obsession, photoUrls });
  logTiming("planning", movieId, planStartedAt);
  const mix = { actualPercent: 75, aiPercent: 25, durationSeconds: HYBRID_DURATION_SECONDS };
  await updateMovie(admin, movieId, userId, { status: "processing", movie_json: { ...plan, mix } });

  const parallelStartedAt = Date.now();
  const [memoryMontage, ai] = await Promise.all([
    loadActualMedia(photoUrls, videoUrls, plan).then((media) =>
      composeMemoryMontage(media.photos, media.videos, MEMORY_COMPOSE_TIMEOUT_MS),
    ),
    generateAiSequence(admin, plan, userId, movieId),
  ]);
  logTiming("parallel_media_and_ai", movieId, parallelStartedAt);

  const composeStartedAt = Date.now();
  const finalVideo = await composeHybridMovie(memoryMontage, ai.data, plan, HYBRID_COMPOSE_TIMEOUT_MS);
  logTiming("concat", movieId, composeStartedAt);
  const finalPath = `${userId}/${movieId}.mp4`;
  await uploadMovieAsset(admin, finalPath, finalVideo, "video/mp4");
  await updateMovie(admin, movieId, userId, {
    status: "completed",
    movie_json: {
      ...plan,
      mix,
      generatedMotifs: ai.generatedMotifs,
      generatedScenes: [{ order: 1, path: ai.path, providerJobId: ai.providerJobId, status: "succeeded", retryCount: 0 }],
    },
    video_path: finalPath,
    error_message: null,
  });
}

async function markFailed(admin: AdminClient, movieId: string, userId: string, error: unknown) {
  const failure = error instanceof GenerationStageError ? error : new GenerationStageError("動画生成", classifyError(error));
  console.error(JSON.stringify({ stage: "failure", category: failure.category, movieId }));
  try {
    await updateMovie(admin, movieId, userId, { status: "failed", error_message: failure.message });
  } catch (updateError) {
    console.error(JSON.stringify({ stage: "failure_status_update", category: classifyError(updateError), movieId }));
  }
}

export async function processMovieGeneration(movieId: string, userId: string, obsession: ObsessionAnalysis) {
  const admin = createAdminClient();
  beginMovieImageCache();
  try {
    await completeMovieGeneration(admin, movieId, userId, obsession);
  } catch (error) {
    await markFailed(admin, movieId, userId, error);
  }
}
