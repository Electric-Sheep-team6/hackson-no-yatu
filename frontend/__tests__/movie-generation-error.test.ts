import { describe, expect, it } from "vitest";

import { formatMovieGenerationError } from "@/lib/ai/video/movieGenerationError";

describe("formatMovieGenerationError", () => {
  it("環境変数未設定を利用者が解決できる文言にする", () => {
    expect(
      formatMovieGenerationError(
        "シーン動画の生成",
        new Error("GEMINI_API_KEY is not configured"),
      ),
    ).toBe(
      "シーン動画を生成できませんでした。GEMINI_API_KEY をサーバー環境変数に設定してください。",
    );
  });

  it("プロバイダーの失敗を処理段階とともに残す", () => {
    expect(
      formatMovieGenerationError("映画構成の作成", new Error("API request timed out")),
    ).toBe("映画構成の作成で失敗しました: API request timed out");
  });
});
