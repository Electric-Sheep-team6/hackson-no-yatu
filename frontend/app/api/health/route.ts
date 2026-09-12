import { constants } from "node:fs";
import { access } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { VENDOR_FFMPEG_PATH, VENDOR_FONT_PATH } from "../../../lib/ai/video/runtimeAssets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_PROVIDER_OPENAI = "openai";
const AI_PROVIDER_GEMINI = "gemini";
const DEFAULT_AI_TEXT_PROVIDER = AI_PROVIDER_OPENAI;
const UNHEALTHY_STATUS = 503;

const SYSTEM_FFMPEG_PATHS = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
] as const;

type AiTextProvider = typeof AI_PROVIDER_OPENAI | typeof AI_PROVIDER_GEMINI;
type FfmpegSource = "vendor" | "env" | "system";

type EnvironmentStatus = Readonly<{
  NEXT_PUBLIC_SUPABASE_URL: boolean;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: boolean;
  SUPABASE_SERVICE_ROLE_KEY: boolean;
  OPENAI_API_KEY: boolean;
  GEMINI_API_KEY: boolean;
  AI_TEXT_PROVIDER: boolean;
  FFMPEG_PATH: boolean;
}>;

const isConfigured = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const getEnvironmentStatus = (): EnvironmentStatus => ({
  NEXT_PUBLIC_SUPABASE_URL: isConfigured(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: isConfigured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  SUPABASE_SERVICE_ROLE_KEY: isConfigured(process.env.SUPABASE_SERVICE_ROLE_KEY),
  OPENAI_API_KEY: isConfigured(process.env.OPENAI_API_KEY),
  GEMINI_API_KEY: isConfigured(process.env.GEMINI_API_KEY),
  AI_TEXT_PROVIDER: isConfigured(process.env.AI_TEXT_PROVIDER),
  FFMPEG_PATH: isConfigured(process.env.FFMPEG_PATH),
});

const getEffectiveAiProvider = (): string =>
  process.env.AI_TEXT_PROVIDER?.trim().toLowerCase() || DEFAULT_AI_TEXT_PROVIDER;

const isValidAiProvider = (provider: string): provider is AiTextProvider =>
  provider === AI_PROVIDER_OPENAI || provider === AI_PROVIDER_GEMINI;

const canAccess = async (path: string, mode: number = constants.F_OK): Promise<boolean> => {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
};

// vendor/ffmpeg/ffmpeg はLinux x64のELFバイナリなので、そのプラットフォームのときだけ
// 最優先候補にする。macOSではファイルが存在してもexecできないため候補から外す。
const isVendorFfmpegCompatiblePlatform = (): boolean =>
  process.platform === "linux" && process.arch === "x64";

const getFfmpegCandidates = (): ReadonlyArray<{ path: string; source: FfmpegSource }> => {
  const candidates: Array<{ path: string; source: FfmpegSource }> = [];
  if (isVendorFfmpegCompatiblePlatform()) {
    candidates.push({ path: VENDOR_FFMPEG_PATH, source: "vendor" });
  }
  if (isConfigured(process.env.FFMPEG_PATH)) {
    candidates.push({ path: process.env.FFMPEG_PATH, source: "env" });
  }
  for (const systemPath of SYSTEM_FFMPEG_PATHS) {
    candidates.push({ path: systemPath, source: "system" });
  }
  return candidates;
};

type FfmpegStatus = Readonly<{
  available: boolean;
  path: string | null;
  source: FfmpegSource | null;
}>;

const resolveFfmpegStatus = async (): Promise<FfmpegStatus> => {
  for (const candidate of getFfmpegCandidates()) {
    if (await canAccess(candidate.path, constants.X_OK)) {
      return { available: true, path: candidate.path, source: candidate.source };
    }
  }
  return { available: false, path: null, source: null };
};

type FontStatus = Readonly<{
  available: boolean;
  path: string | null;
  expectedPath: string;
}>;

const resolveFontStatus = async (): Promise<FontStatus> => {
  const available = await canAccess(VENDOR_FONT_PATH, constants.R_OK);
  return {
    available,
    path: available ? VENDOR_FONT_PATH : null,
    expectedPath: VENDOR_FONT_PATH,
  };
};

const canConnectToSupabase = async (): Promise<boolean> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isConfigured(url) || !isConfigured(serviceRoleKey)) return false;

  try {
    // 特定テーブルを決め打ちすると誤検知するため、Storage APIで疎通だけ確認する。
    const supabase = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await supabase.storage.listBuckets();
    return error === null;
  } catch {
    return false;
  }
};

const areRequiredEnvironmentVariablesConfigured = (
  environment: EnvironmentStatus,
  provider: string,
): boolean => {
  const baseVariablesConfigured =
    environment.NEXT_PUBLIC_SUPABASE_URL
    && environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
    && environment.SUPABASE_SERVICE_ROLE_KEY
    && environment.GEMINI_API_KEY;

  if (!baseVariablesConfigured || !isValidAiProvider(provider)) return false;
  if (provider === AI_PROVIDER_OPENAI) return environment.OPENAI_API_KEY;
  return true;
};

export async function GET(): Promise<NextResponse> {
  const environment = getEnvironmentStatus();
  const aiTextProvider = getEffectiveAiProvider();
  const [ffmpeg, font, supabaseConnected] = await Promise.all([
    resolveFfmpegStatus(),
    resolveFontStatus(),
    canConnectToSupabase(),
  ]);

  const aiTextProviderValid = isValidAiProvider(aiTextProvider);
  const ok = areRequiredEnvironmentVariablesConfigured(environment, aiTextProvider)
    && aiTextProviderValid
    && ffmpeg.available
    && font.available
    && supabaseConnected;

  return NextResponse.json({
    ok,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      vercel: Boolean(process.env.VERCEL),
    },
    // 環境変数は「設定されているか」だけを返し、値は絶対に返さない。
    environment,
    aiTextProvider: { configured: environment.AI_TEXT_PROVIDER, valid: aiTextProviderValid },
    ffmpeg,
    font,
    supabase: { connected: supabaseConnected },
  }, {
    status: ok ? 200 : UNHEALTHY_STATUS,
    headers: { "Cache-Control": "no-store" },
  });
}
