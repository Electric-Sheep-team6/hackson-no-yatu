import { NextResponse } from "next/server";

import type { MovieScript } from "@/lib/ai/generateMovieScript";
import { ApiError, errorResponse } from "@/lib/apiError";
import { createClient } from "@/lib/supabase/server";
import { movieIdSchema } from "@/lib/validation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new ApiError(401, "unauthorized", "ログインが必要です");
    }

    const { id } = await context.params;
    const movieId = movieIdSchema.parse(id);
    const { data: movie, error } = await supabase
      .from("movies")
      .select("id, status, video_path, error_message, movie_json")
      .eq("id", movieId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!movie) {
      throw new ApiError(404, "not_found", "映画が見つかりません");
    }

    return NextResponse.json({
      id: movie.id,
      status: movie.status,
      videoPath: movie.video_path,
      errorMessage: movie.error_message,
      movie: movie.movie_json as MovieScript | null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
