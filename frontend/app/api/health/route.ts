import { access } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import ffmpegStaticPath from "ffmpeg-static";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_PROVIDER_OPENAI = "openai";
const AI_PROVIDER_GEMINI = "gemini";
const DEFAULT_AI_TEXT_PROVIDER = AI_PROVIDER_OPENAI;
const UNHEALTHY_STATUS = 503;

const SYSTEM_FFMPEG_PATHS = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"] as const;

type AiTextProvider = typeof AI_PROVIDER_OPENAI | typeof AI_PROVIDER_GEMINI;

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

const canAccess = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const getFfmpegCandidates = (): readonly string[] =>
  [process.env.FFMPEG_PATH, ffmpegStaticPath ?? undefined, ...SYSTEM_FFMPEG_PATHS]
    .filter((candidate): candidate is string => isConfigured(candidate));

const resolveFfmpegPath = async (): Promise<string | null> => {
  for (const candidate of getFfmpegCandidates()) {
    if (await canAccess(candidate)) return candidate;
  }
  return null;
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
  const [ffmpegPath, supabaseConnected] = await Promise.all([
    resolveFfmpegPath(),
    canConnectToSupabase(),
  ]);

  const aiTextProviderValid = isValidAiProvider(aiTextProvider);
  const ok = areRequiredEnvironmentVariablesConfigured(environment, aiTextProvider)
    && aiTextProviderValid
    && ffmpegPath !== null
    && supabaseConnected;

  return NextResponse.json({
    ok,
    // 環境変数は「設定されているか」だけを返し、値は絶対に返さない。
    environment,
    aiTextProvider: { configured: environment.AI_TEXT_PROVIDER, valid: aiTextProviderValid },
    ffmpeg: { available: ffmpegPath !== null, path: ffmpegPath },
    supabase: { connected: supabaseConnected },
  }, {
    status: ok ? 200 : UNHEALTHY_STATUS,
    headers: { "Cache-Control": "no-store" },
  });
}
