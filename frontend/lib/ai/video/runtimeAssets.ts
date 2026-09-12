import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

// vendor/ 配下に直接コミットしたLinux x64静的FFmpegとNoto Sans JP Bold。
// process.cwd() はNext.jsのプロジェクトルート(Vercelでは/var/task)を基準にするため、
// import.meta.url からの相対解決より安定する(ビルド後にモジュールがchunkへ
// 移動・bundleされてもvendor/の位置は変わらない)。
export const VENDOR_FFMPEG_PATH = path.join(
  process.cwd(),
  "vendor",
  "ffmpeg",
  "ffmpeg",
);

export const VENDOR_FONT_PATH = path.join(
  process.cwd(),
  "vendor",
  "fonts",
  "NotoSansJP-Bold.ttf",
);

const SYSTEM_FFMPEG_PATHS = [
  "/opt/homebrew/bin/ffmpeg", // macOS Apple Silicon Homebrew (ローカル開発)
  "/usr/local/bin/ffmpeg", // macOS Intel Homebrew / Linuxのローカルインストール
  "/usr/bin/ffmpeg", // Linux
];

async function isAccessible(filePath: string, mode: number): Promise<boolean> {
  try {
    await access(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

function isVendorFfmpegCompatiblePlatform(): boolean {
  // vendor/ffmpeg/ffmpeg はLinux x64のELFバイナリ。macOS開発環境ではファイル自体は
  // 存在・実行権限ありに見えても実行できないため、Linux x64のときだけ候補に入れる。
  return process.platform === "linux" && process.arch === "x64";
}

function buildFfmpegCandidates(): string[] {
  const candidates: string[] = [];
  if (isVendorFfmpegCompatiblePlatform()) {
    candidates.push(VENDOR_FFMPEG_PATH);
  }
  if (process.env.FFMPEG_PATH) {
    candidates.push(process.env.FFMPEG_PATH);
  }
  candidates.push(...SYSTEM_FFMPEG_PATHS);
  return candidates;
}

export async function resolveFfmpegPath(): Promise<string> {
  const candidates = buildFfmpegCandidates();
  for (const candidate of candidates) {
    if (await isAccessible(candidate, constants.X_OK)) {
      return candidate;
    }
  }
  throw new Error(
    [
      "FFmpeg binary is not available.",
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `cwd=${process.cwd()}`,
      `candidates=${JSON.stringify(candidates)}`,
    ].join(" "),
  );
}

export async function resolveFontPath(): Promise<string> {
  if (await isAccessible(VENDOR_FONT_PATH, constants.R_OK)) {
    return VENDOR_FONT_PATH;
  }
  throw new Error(`Bundled font is not available: ${VENDOR_FONT_PATH}`);
}
