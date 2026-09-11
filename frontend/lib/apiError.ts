import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ApiErrorBody = {
  error: string;
  message: string;
};

type ApiErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
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

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json<ApiErrorBody>(
      { error: error.code, message: error.message },
      { status: error.status },
    );
  }

  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json<ApiErrorBody>(
      { error: "invalid_request", message: "リクエストが不正です" },
      { status: 400 },
    );
  }

  console.error(error);
  return NextResponse.json<ApiErrorBody>(
    { error: "internal_error", message: "サーバー内部でエラーが発生しました" },
    { status: 500 },
  );
}
