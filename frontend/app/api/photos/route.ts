import { NextResponse } from "next/server";

import { ApiError, errorResponse } from "@/lib/apiError";
import { createClient } from "@/lib/supabase/server";
import {
  createPhotoSchema,
  isAllowedPhotoMimeType,
  isOwnedPhotoStoragePath,
  MAX_PHOTO_BYTES,
} from "@/lib/validation";

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

    if (!isOwnedPhotoStoragePath(storagePath, user.id)) {
      throw new ApiError(
        403,
        "forbidden",
        "このストレージパスは使用できません",
      );
    }

    const { data: photoInfo, error: storageError } = await supabase.storage
      .from("photos")
      .info(storagePath);
    if (!photoInfo) {
      if (storageError && storageError.status !== 404) throw storageError;
      throw new ApiError(
        400,
        "invalid_request",
        "アップロード済みの写真が見つかりません",
      );
    }
    if (storageError) throw storageError;
    if (!isAllowedPhotoMimeType(photoInfo.contentType ?? "")) {
      throw new ApiError(
        400,
        "invalid_request",
        "JPEG、PNG、WebP形式の画像を選択してください",
      );
    }
    if (photoInfo.size === 0 || (photoInfo.size ?? 0) > MAX_PHOTO_BYTES) {
      throw new ApiError(
        400,
        "invalid_request",
        "画像ファイルは1バイト以上10MB以下にしてください",
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
      .from("photos")
      .select("id, storage_path, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json({
      items: data.map((photo) => ({
        id: photo.id,
        storagePath: photo.storage_path,
        createdAt: photo.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
