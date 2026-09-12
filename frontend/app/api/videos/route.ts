import { NextResponse } from "next/server";

import { ApiError, errorResponse } from "@/lib/apiError";
import { createClient } from "@/lib/supabase/server";
import { createVideoSchema } from "@/lib/validation";

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new ApiError(401, "unauthorized", "ログインが必要です");
  return { supabase, user };
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticatedClient();
    const { storagePath } = createVideoSchema.parse(await request.json());
    if (storagePath.split("/")[0] !== user.id) {
      throw new ApiError(403, "forbidden", "このストレージパスは使用できません");
    }
    const { data, error } = await supabase.from("videos").insert({
      user_id: user.id,
      storage_path: storagePath,
    }).select("id, storage_path, created_at").single();
    if (error) throw error;
    return NextResponse.json({
      id: data.id,
      storagePath: data.storage_path,
      createdAt: data.created_at,
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const { supabase, user } = await authenticatedClient();
    const { data, error } = await supabase.from("videos")
      .select("id, storage_path, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ items: data.map((video) => ({
      id: video.id,
      storagePath: video.storage_path,
      createdAt: video.created_at,
    })) });
  } catch (error) {
    return errorResponse(error);
  }
}
