type MovieGenerationStage =
  | "写真の準備"
  | "映画構成の作成"
  | "シーン動画の生成"
  | "映像の結合"
  | "完成動画の保存";

const MAX_ERROR_MESSAGE_LENGTH = 500;

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラー";
}

/**
 * Store an actionable error for the owner without exposing credentials or an
 * unbounded provider response in the database/UI.
 */
export function formatMovieGenerationError(
  stage: MovieGenerationStage,
  error: unknown,
) {
  const message = messageFrom(error);

  if (message.includes("OPENAI_API_KEY is not configured")) {
    return "映画構成を作成できませんでした。OPENAI_API_KEY をサーバー環境変数に設定してください。";
  }

  if (message.includes("GEMINI_API_KEY is not configured")) {
    return "シーン動画を生成できませんでした。GEMINI_API_KEY をサーバー環境変数に設定してください。";
  }

  return `${stage}で失敗しました: ${message}`.slice(
    0,
    MAX_ERROR_MESSAGE_LENGTH,
  );
}
