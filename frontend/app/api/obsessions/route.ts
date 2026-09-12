import { NextResponse } from "next/server";

import { analyzeObsession } from "@/lib/ai/analyzeObsession";
import { ApiError, errorResponse } from "@/lib/apiError";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new ApiError(401, "unauthorized", "ログインが必要です");
    }

    const admin = createAdminClient();
    const { data: claimed, error: claimError } = await admin.rpc(
      "claim_obsession_analysis",
      { p_user_id: user.id },
    );
    if (claimError) throw claimError;
    if (!claimed) {
      throw new ApiError(429, "rate_limited", "偏愛分析は24時間に10回までです");
    }

    const [diariesResult, photosResult] = await Promise.all([
      supabase
        .from("diaries")
        .select("content")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("photos")
        .select("storage_path")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(26),
    ]);

    if (diariesResult.error) throw diariesResult.error;
    if (photosResult.error) throw photosResult.error;

    if (diariesResult.data.length === 0 && photosResult.data.length === 0) {
      throw new ApiError(
        400,
        "invalid_request",
        "先に日記か写真を追加してください",
      );
    }

    const signedUrlResults = await Promise.all(
      photosResult.data.map(({ storage_path }) =>
        supabase.storage.from("photos").createSignedUrl(storage_path, 3600),
      ),
    );
    const photoUrls = signedUrlResults.map(({ data, error }) => {
      if (error || !data) throw error ?? new Error("Failed to sign photo URL");
      return data.signedUrl;
    });

    const analysis = await analyzeObsession({
      diaryTexts: [...diariesResult.data]
        .reverse()
        .map(({ content }) => content),
      photoUrls,
    });
    const { data, error } = await admin
      .from("obsessions")
      .insert({
        user_id: user.id,
        title: analysis.title,
        reason: analysis.reason,
        analysis_json: analysis,
      })
      .select("id, title, reason, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json(
      {
        id: data.id,
        title: data.title,
        reason: data.reason,
        createdAt: data.created_at,
      },
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
      .from("obsessions")
      .select("id, title, reason, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      items: data.map((obsession) => ({
        id: obsession.id,
        title: obsession.title,
        reason: obsession.reason,
        createdAt: obsession.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
