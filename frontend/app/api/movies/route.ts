import { after, NextResponse } from "next/server";

import type { ObsessionAnalysis } from "@/lib/ai/analyzeObsession";
import { generateMovieScript } from "@/lib/ai/generateMovieScript";
import { composeMovie } from "@/lib/ai/video/composeMovie";
import { geminiVideoGenerator } from "@/lib/ai/video/geminiVideoGenerator";
import { selectReferenceImageUrls } from "@/lib/ai/video/selectReferenceImageUrls";
import { ApiError, errorResponse } from "@/lib/apiError";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createMovieSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const DAILY_MOVIE_LIMIT = 3;

async function processMovieGeneration(
  movieId: string,
  userId: string,
  obsession: ObsessionAnalysis,
) {
  const admin = createAdminClient();

  try {
    let result = await admin
      .from("movies")
      .update({ status: "analyzing", updated_at: new Date().toISOString() })
      .eq("id", movieId)
      .eq("user_id", userId);
    if (result.error) throw result.error;

    const photosResult = await admin
      .from("photos")
      .select("storage_path")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (photosResult.error) throw photosResult.error;

    const signedUrlResults = await Promise.all(
      photosResult.data.map(({ storage_path }) =>
        admin.storage.from("photos").createSignedUrl(storage_path, 3600),
      ),
    );
    const photoUrls = signedUrlResults.map(({ data, error }) => {
      if (error || !data) throw error ?? new Error("Failed to sign photo URL");
      return data.signedUrl;
    });

    result = await admin
      .from("movies")
      .update({ status: "generating", updated_at: new Date().toISOString() })
      .eq("id", movieId)
      .eq("user_id", userId);
    if (result.error) throw result.error;

    const movie = await generateMovieScript({ obsession, photoUrls });

    result = await admin
      .from("movies")
      .update({
        status: "processing",
        movie_json: movie,
        updated_at: new Date().toISOString(),
      })
      .eq("id", movieId)
      .eq("user_id", userId);
    if (result.error) throw result.error;

    const generatedScenes: { order: number; path: string; providerJobId: string }[] = [];
    const sceneVideos: Uint8Array[] = [];
    for (const scene of movie.scenes) {
      const generated = await geminiVideoGenerator.generateScene({
        prompt: scene.videoPrompt,
        duration: scene.duration,
        referenceImageUrls: selectReferenceImageUrls(
          scene.referencePhotoUrls,
          photoUrls,
        ),
      });
      if (!generated.videoData) throw new Error("動画データがありません");
      const path = `${userId}/${movieId}/scenes/${scene.order}.mp4`;
      const { error: uploadError } = await admin.storage
        .from("movies")
        .upload(path, generated.videoData, { contentType: "video/mp4", upsert: true });
      if (uploadError) throw uploadError;
      generatedScenes.push({ order: scene.order, path, providerJobId: generated.providerJobId });
      sceneVideos.push(generated.videoData);
    }

    const finalVideo = await composeMovie(sceneVideos);
    const finalPath = `${userId}/${movieId}.mp4`;
    const { error: finalUploadError } = await admin.storage.from("movies").upload(
      finalPath,
      finalVideo,
      { contentType: "video/mp4", upsert: true },
    );
    if (finalUploadError) throw finalUploadError;

    result = await admin
      .from("movies")
      .update({
        status: "completed",
        movie_json: { ...movie, generatedScenes },
        video_path: finalPath,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", movieId)
      .eq("user_id", userId);
    if (result.error) throw result.error;
  } catch (error) {
    console.error(error);
    const { error: updateError } = await admin
      .from("movies")
      .update({
        status: "failed",
        error_message: "動画生成に失敗しました",
        updated_at: new Date().toISOString(),
      })
      .eq("id", movieId)
      .eq("user_id", userId);

    if (updateError) console.error(updateError);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new ApiError(401, "unauthorized", "ログインが必要です");
    }

    const { obsessionId } = createMovieSchema.parse(await request.json());
    const admin = createAdminClient();
    const { data: obsession, error: obsessionError } = await admin
      .from("obsessions")
      .select("id, user_id, analysis_json")
      .eq("id", obsessionId)
      .maybeSingle();

    if (obsessionError) throw obsessionError;
    if (!obsession) {
      throw new ApiError(404, "not_found", "偏愛が見つかりません");
    }
    if (obsession.user_id !== user.id) {
      throw new ApiError(403, "forbidden", "この偏愛は使用できません");
    }

    const { error: staleMovieError } = await admin.rpc(
      "recover_stale_movie_generations",
      { p_user_id: user.id },
    );
    if (staleMovieError) throw staleMovieError;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await admin
      .from("movies")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (countError) throw countError;
    if ((count ?? 0) >= DAILY_MOVIE_LIMIT) {
      throw new ApiError(429, "rate_limited", "映画生成は24時間に3回までです");
    }

    const { data: movie, error: movieError } = await admin
      .from("movies")
      .insert({
        user_id: user.id,
        obsession_id: obsessionId,
        status: "pending",
      })
      .select("id, status")
      .single();

    if (movieError?.code === "23505") {
      throw new ApiError(
        409,
        "conflict",
        "生成中の映画があります。完了後に再度お試しください",
      );
    }
    if (movieError) throw movieError;

    after(() =>
      processMovieGeneration(
        movie.id,
        user.id,
        obsession.analysis_json as ObsessionAnalysis,
      ),
    );

    return NextResponse.json(
      { id: movie.id, status: "pending" as const },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new ApiError(401, "unauthorized", "ログインが必要です");
    }

    const { data, error } = await supabase
      .from("movies")
      .select("id, status, obsession_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      items: data.map((movie) => ({
        id: movie.id,
        status: movie.status,
        obsessionId: movie.obsession_id,
        createdAt: movie.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
