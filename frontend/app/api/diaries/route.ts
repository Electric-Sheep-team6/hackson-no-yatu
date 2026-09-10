import { NextResponse } from "next/server";

import { ApiError, errorResponse } from "@/lib/apiError";
import { createClient } from "@/lib/supabase/server";
import { createDiarySchema } from "@/lib/validation";

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

    const { content } = createDiarySchema.parse(await request.json());
    const { data, error } = await supabase
      .from("diaries")
      .insert({ user_id: user.id, content })
      .select("id, content, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json(
      { id: data.id, content: data.content, createdAt: data.created_at },
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
      .from("diaries")
      .select("id, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      items: data.map((diary) => ({
        id: diary.id,
        content: diary.content,
        createdAt: diary.created_at,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
