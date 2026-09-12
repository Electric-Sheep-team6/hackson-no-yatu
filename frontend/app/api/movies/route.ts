import { after, NextResponse } from "next/server";

import type { ObsessionAnalysis } from "@/lib/ai/analyzeObsession";
import { ApiError, errorResponse } from "@/lib/apiError";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createMovieSchema } from "@/lib/validation";

import { processMovieGeneration } from "./generation";

export const runtime = "nodejs";
// シーン生成1波（最大120秒）+ 連結（最大120秒）を300秒以内で完了させる。
export const maxDuration = 300;

const DAILY_MOVIE_LIMIT = 3;

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
