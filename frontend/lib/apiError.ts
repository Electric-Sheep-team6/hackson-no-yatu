import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ApiErrorBody = {
  error: string;
  message: string;
  requestId: string;
};

type ApiErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// Route Handler が自身の呼び出し元(メソッド+パス)を明示するための最小限の文脈。
// これが無いと、本番ログで「どのエンドポイントが失敗したか」を後から追えない。
export type ApiErrorContext = {
  route: string; // 例: "GET /api/obsessions"
};

// Supabase(PostgREST/postgres-js)のエラーは Error のインスタンスではなく、
// code/details/hint を持つプレーンオブジェクトで返ってくることが多い。
// console.error(error) だけでは JSON ログ上でこれらのフィールドが欠落しやすいため、
// 存在すれば明示的に拾って構造化ログに含める。
function extractKnownFields(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return {};

  const fields: Record<string, unknown> = {};
  for (const key of ["code", "details", "hint", "status", "providerStatus", "retryable"] as const) {
    if (key in error) {
      fields[key] = (error as Record<string, unknown>)[key];
    }
  }
  return fields;
}

// 500 を返す直前に、後から grep できる1行JSONを必ず出す。
// requestId はレスポンス側にも同じ値を返すため、ブラウザの
// 「Failed to load resource: 500」から該当するサーバーログ行を一意に特定できる。
function logServerError(context: ApiErrorContext, requestId: string, error: unknown) {
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      route: context.route,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...extractKnownFields(error),
    }),
  );
}

export function errorResponse(error: unknown, context: ApiErrorContext) {
  const requestId = randomUUID();

  if (error instanceof ApiError) {
    // 4xx はクライアント起因の想定内エラーなのでログ不要。5xx の ApiError だけ記録する。
    if (error.status >= 500) logServerError(context, requestId, error);
    return NextResponse.json<ApiErrorBody>(
      { error: error.code, message: error.message, requestId },
      { status: error.status },
    );
  }

  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json<ApiErrorBody>(
      { error: "invalid_request", message: "リクエストが不正です", requestId },
      { status: 400 },
    );
  }

  logServerError(context, requestId, error);
  return NextResponse.json<ApiErrorBody>(
    { error: "internal_error", message: "サーバー内部でエラーが発生しました", requestId },
    { status: 500 },
  );
}
