import { NextResponse } from "next/server";

import { ApiError, errorResponse } from "@/lib/apiError";
import { createClient } from "@/lib/supabase/server";
import { createPhotoSchema } from "@/lib/validation";

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

    const { storagePath, diaryId = null } = createPhotoSchema.parse(
      await request.json(),
    );

    if (storagePath.split("/")[0] !== user.id) {
      throw new ApiError(
        403,
        "forbidden",
        "このストレージパスは使用できません",
      );
    }

    if (diaryId) {
      const { data: diary, error: diaryError } = await supabase
        .from("diaries")
        .select("id")
        .eq("id", diaryId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (diaryError) throw diaryError;
      if (!diary) {
        throw new ApiError(403, "forbidden", "この日記は使用できません");
      }
    }

    const { data, error } = await supabase
      .from("photos")
      .insert({
        user_id: user.id,
        storage_path: storagePath,
        diary_id: diaryId,
      })
      .select("id, storage_path, diary_id, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json(
      {
        id: data.id,
        storagePath: data.storage_path,
        diaryId: data.diary_id,
        createdAt: data.created_at,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
