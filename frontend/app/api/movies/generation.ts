import type { ObsessionAnalysis } from "@/lib/ai/analyzeObsession";
import {
  generateMovieScript,
  type MovieScript,
} from "@/lib/ai/generateMovieScript";
import { composeMovie } from "@/lib/ai/video/composeMovie";
import { geminiVideoGenerator } from "@/lib/ai/video/geminiVideoGenerator";
import type { GenerateSceneResult } from "@/lib/ai/video/VideoGenerator";
import { selectReferenceImageUrls } from "@/lib/ai/video/selectReferenceImageUrls";
import { beginMovieImageCache } from "@/lib/ai/referenceImage";
import {
  VIDEO_CONCAT_TIMEOUT_MS,
} from "@/lib/ai/timeouts";
import { createAdminClient } from "@/lib/supabase/admin";

export const SCENE_CONCURRENCY = 3;
export const MAX_SCENES = 3;

type AdminClient = ReturnType<typeof createAdminClient>;
type Scene = MovieScript["scenes"][number];
type ErrorCategory =
  | "timeout"
  | "rate_limit"
  | "server"
  | "input_blocked"
  | "other";
type FailureStage = "generation" | "upload";

type GeneratedScene = {
  order: number;
  path: string | null;
  providerJobId: string | null;
  status: "succeeded" | "failed";
  retryCount: number;
  errorCategory?: ErrorCategory;
  failureStage?: FailureStage;
};

type SceneOutcome = {
  metadata: GeneratedScene;
  videoData?: Uint8Array;
};

class GenerationStageError extends Error {
  constructor(
    readonly stageLabel: string,
    readonly category: ErrorCategory,
  ) {
    super(`${stageLabel}に失敗しました（${categoryLabel(category)}）`);
  }
}

class SceneGenerationError extends Error {
  constructor(
    readonly category: ErrorCategory,
    readonly providerJobId: string | null = null,
  ) {
    super("シーン生成に失敗しました");
  }
}

function categoryLabel(category: ErrorCategory) {
  const labels: Record<ErrorCategory, string> = {
    timeout: "タイムアウト",
    rate_limit: "レート制限",
    server: "外部サービスエラー",
    input_blocked: "入力ブロック",
    other: "その他",
  };

  return labels[category];
}

function errorFields(error: unknown) {
  if (!error || typeof error !== "object") {
    return { text: String(error) };
  }

  const value = error as Record<string, unknown>;

  return {
    name: typeof value.name === "string" ? value.name : "",
    text: typeof value.message === "string" ? value.message : "",
    status: typeof value.status === "number" ? value.status : undefined,
    code: typeof value.code === "string" ? value.code : "",
  };
}

function classifyError(error: unknown): ErrorCategory {
  const { name, text, status, code } = errorFields(error);
  const searchable = `${name} ${text} ${code}`.toLowerCase();

  if (status === 400 && searchable.includes("input blocked")) {
    return "input_blocked";
  }

  if (
    status === 429
    || /\b429\b|rate.?limit|too many requests|resource.*exhausted|quota/.test(searchable)
  ) {
    return "rate_limit";
  }

  if (/timeout|timed.?out|aborterror|etimedout/.test(searchable)) {
    return "timeout";
  }

  if (
    (status !== undefined && status >= 500)
    || /\b5\d\d\b|internal (server )?error|service unavailable|bad gateway|overloaded/.test(
      searchable,
    )
  ) {
    return "server";
  }

  return "other";
}

function logTiming(
  stage: "analyzing" | "generating" | "scene" | "concat" | "upload",
  movieId: string,
  startedAt: number,
  order?: number,
) {
  console.log(JSON.stringify({
    stage,
    ...(order === undefined ? {} : { order }),
    ms: Date.now() - startedAt,
    movieId,
  }));
}

async function generateSceneOnce(
  scene: Scene,
  referenceImageUrls: string[],
): Promise<GenerateSceneResult> {
  try {
    const generated = await geminiVideoGenerator.generateScene({
      prompt: scene.videoPrompt,
      duration: scene.duration,
      referenceImageUrls,
    });

    if (!generated.videoData) {
      throw new SceneGenerationError(
        "other",
        generated.providerJobId,
      );
    }

    return generated;
  } catch (error) {
    if (error instanceof SceneGenerationError) {
      throw error;
    }
    throw new SceneGenerationError(classifyError(error));
  }
}

async function uploadScene(
  admin: AdminClient,
  path: string,
  videoData: Uint8Array,
) {
  const { error } = await admin.storage.from("movies").upload(
    path,
    videoData,
    {
      contentType: "video/mp4",
      upsert: true,
    },
  );

  if (error) {
    throw error;
  }
}

async function generateScene(
  admin: AdminClient,
  scene: Scene,
  photoUrls: string[],
  userId: string,
  movieId: string,
): Promise<SceneOutcome> {
  const startedAt = Date.now();

  try {
    return await generateAndUploadScene(
      admin,
      scene,
      photoUrls,
      userId,
      movieId,
    );
  } catch (error) {
    const sceneError =
      error instanceof SceneGenerationError
        ? error
        : undefined;

    return {
      metadata: {
        order: scene.order,
        path: null,
        status: "failed",
        providerJobId: sceneError?.providerJobId ?? null,
        retryCount: 0,
        errorCategory: sceneError?.category ?? classifyError(error),
        failureStage: sceneError ? "generation" : "upload",
      },
    };
  } finally {
    logTiming("scene", movieId, startedAt, scene.order);
  }
}

async function generateAndUploadScene(
  admin: AdminClient,
  scene: Scene,
  photoUrls: string[],
  userId: string,
  movieId: string,
): Promise<SceneOutcome> {
  const referenceImageUrls = selectReferenceImageUrls(
    scene.referencePhotoUrls,
    photoUrls,
  );

  const generated = await generateSceneOnce(
    scene,
    referenceImageUrls,
  );

  const path = `${userId}/${movieId}/scenes/${scene.order}.mp4`;

  try {
    await uploadScene(
      admin,
      path,
      generated.videoData!,
    );
  } catch (error) {
    return {
      metadata: {
        order: scene.order,
        path: null,
        status: "failed",
        providerJobId: generated.providerJobId,
        retryCount: 0,
        errorCategory: classifyError(error),
        failureStage: "upload",
      },
    };
  }

  return {
    metadata: {
      order: scene.order,
      path,
      status: "succeeded",
      providerJobId: generated.providerJobId,
      retryCount: 0,
    },
    videoData: generated.videoData,
  };
}

async function generateSceneBatches(
  admin: AdminClient,
  scenes: Scene[],
  photoUrls: string[],
  userId: string,
  movieId: string,
  offset = 0,
): Promise<SceneOutcome[]> {
  const batch = scenes.slice(
    offset,
    offset + SCENE_CONCURRENCY,
  );

  if (batch.length === 0) {
    return [];
  }

  const outcomes = await Promise.all(
    batch.map((scene) =>
      generateScene(
        admin,
        scene,
        photoUrls,
        userId,
        movieId,
      ),
    ),
  );

  const remaining = await generateSceneBatches(
    admin,
    scenes,
    photoUrls,
    userId,
    movieId,
    offset + SCENE_CONCURRENCY,
  );

  return [...outcomes, ...remaining];
}

async function updateMovie(
  admin: AdminClient,
  movieId: string,
  userId: string,
  values: Record<string, unknown>,
) {
  const { error } = await admin
    .from("movies")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", movieId)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }
}

async function loadPhotoUrls(
  admin: AdminClient,
  userId: string,
) {
  const photosResult = await admin
    .from("photos")
    .select("storage_path")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (photosResult.error) {
    throw photosResult.error;
  }

  const results = await Promise.all(
    photosResult.data.map(({ storage_path }) =>
      admin.storage
        .from("photos")
        .createSignedUrl(storage_path, 3_600),
    ),
  );

  return results.map(({ data, error }) => {
    if (error || !data) {
      throw error ?? new Error("写真の署名URLを生成できませんでした");
    }

    return data.signedUrl;
  });
}

async function prepareGeneration(
  admin: AdminClient,
  movieId: string,
  userId: string,
) {
  const startedAt = Date.now();

  try {
    await updateMovie(
      admin,
      movieId,
      userId,
      { status: "analyzing" },
    );

    return await loadPhotoUrls(admin, userId);
  } catch (error) {
    throw new GenerationStageError(
      "生成準備",
      classifyError(error),
    );
  } finally {
    logTiming("analyzing", movieId, startedAt);
  }
}

async function createScript(
  admin: AdminClient,
  movieId: string,
  userId: string,
  obsession: ObsessionAnalysis,
  photoUrls: string[],
) {
  const startedAt = Date.now();

  try {
    await updateMovie(
      admin,
      movieId,
      userId,
      { status: "generating" },
    );

    const script = await generateMovieScript({
      obsession,
      photoUrls,
    });

    const scenes = script.scenes
      .toSorted((a, b) => a.order - b.order)
      .slice(0, MAX_SCENES);

    return {
      ...script,
      scenes,
    };
  } catch (error) {
    throw new GenerationStageError(
      "脚本生成",
      classifyError(error),
    );
  } finally {
    logTiming("generating", movieId, startedAt);
  }
}

async function composeScenes(
  outcomes: SceneOutcome[],
  movieId: string,
  movie: MovieScript,
) {
  const failed = outcomes.find(
    ({ metadata }) => metadata.status === "failed",
  );

  if (failed) {
    const action =
      failed.metadata.failureStage === "upload"
        ? "アップロード"
        : "生成";

    throw new GenerationStageError(
      `シーン${failed.metadata.order}の${action}`,
      failed.metadata.errorCategory ?? "other",
    );
  }

  return composeSuccessfulScenes(
    outcomes,
    movieId,
    movie,
  );
}

async function composeSuccessfulScenes(
  outcomes: SceneOutcome[],
  movieId: string,
  movie: MovieScript,
) {
  const startedAt = Date.now();

  try {
    const sceneVideos = outcomes.map(
      ({ videoData }) => videoData!,
    );

    return await composeMovie(
      sceneVideos,
      {
        title: movie.title,
        logline: movie.logline,
        scenes: movie.scenes.map((scene) => ({
          narration: scene.narration,
        })),
      },
      VIDEO_CONCAT_TIMEOUT_MS,
    );
  } catch (error) {
    throw new GenerationStageError(
      "動画の連結",
      classifyError(error),
    );
  } finally {
    logTiming("concat", movieId, startedAt);
  }
}

async function uploadMovie(
  admin: AdminClient,
  movieId: string,
  userId: string,
  finalVideo: Uint8Array,
) {
  const startedAt = Date.now();
  const finalPath = `${userId}/${movieId}.mp4`;

  try {
    const { error } = await admin.storage
      .from("movies")
      .upload(
        finalPath,
        finalVideo,
        {
          contentType: "video/mp4",
          upsert: true,
        },
      );

    if (error) {
      throw error;
    }

    return finalPath;
  } catch (error) {
    throw new GenerationStageError(
      "完成動画のアップロード",
      classifyError(error),
    );
  } finally {
    logTiming("upload", movieId, startedAt);
  }
}

async function markFailed(
  admin: AdminClient,
  movieId: string,
  userId: string,
  error: unknown,
) {
  const failure =
    error instanceof GenerationStageError
      ? error
      : new GenerationStageError(
          "動画生成",
          classifyError(error),
        );

  console.error(JSON.stringify({
    stage: "failure",
    category: failure.category,
    movieId,
  }));

  try {
    await updateMovie(
      admin,
      movieId,
      userId,
      {
        status: "failed",
        error_message: failure.message,
      },
    );
  } catch (updateError) {
    console.error(JSON.stringify({
      stage: "failure_status_update",
      category: classifyError(updateError),
      movieId,
    }));
  }
}

async function completeMovieGeneration(
  admin: AdminClient,
  movieId: string,
  userId: string,
  obsession: ObsessionAnalysis,
) {
  const photoUrls = await prepareGeneration(
    admin,
    movieId,
    userId,
  );

  const movie = await createScript(
    admin,
    movieId,
    userId,
    obsession,
    photoUrls,
  );

  await updateMovie(admin, movieId, userId, {
    status: "processing",
    movie_json: movie,
  });

  const outcomes = await generateSceneBatches(
    admin,
    movie.scenes,
    photoUrls,
    userId,
    movieId,
  );

  const generatedScenes = outcomes.map(
    ({ metadata }) => metadata,
  );

  await updateMovie(admin, movieId, userId, {
    movie_json: {
      ...movie,
      generatedScenes,
    },
  });

  const finalVideo = await composeScenes(
    outcomes,
    movieId,
    movie,
  );

  const finalPath = await uploadMovie(
    admin,
    movieId,
    userId,
    finalVideo,
  );

  await updateMovie(admin, movieId, userId, {
    status: "completed",
    movie_json: {
      ...movie,
      generatedScenes,
    },
    video_path: finalPath,
    error_message: null,
  });
}

export async function processMovieGeneration(
  movieId: string,
  userId: string,
  obsession: ObsessionAnalysis,
) {
  const admin = createAdminClient();

  // 同一映画の生成内では、同じ参照画像を一度しか取得しない。
  beginMovieImageCache();

  try {
    await completeMovieGeneration(
      admin,
      movieId,
      userId,
      obsession,
    );
  } catch (error) {
    await markFailed(
      admin,
      movieId,
      userId,
      error,
    );
  }
}
