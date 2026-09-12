import type { NextConfig } from "next";

// vendor/ 配下に直接コミットしたFFmpeg(linux x64静的バイナリ)と日本語フォント。
// ffmpeg-static のダウンロードやNext.jsのimport解析に頼らず、実ファイルを明示的に
// 各Serverless Functionへ同梱する。ディレクトリ名ではなく実ファイルまで拾うglobにする
// (ディレクトリ名だけだと中身が空でトレースされないことがある)。
const RUNTIME_ASSET_GLOBS = [
  "./vendor/ffmpeg/**/*",
  "./vendor/fonts/**/*",
];

const nextConfig: NextConfig = {
  // キーはファイルパスではなくルートパス(/api/movies など)。picomatchでマッチする。
  // 巨大バイナリ(約80MB)を不要なFunctionにまで複製しないよう、実際に使うルートだけに絞る。
  outputFileTracingIncludes: {
    // 動画生成は /api/movies (作成) と /api/movies/[id] (バックグラウンド生成) の
    // 両方から composeMovie / prepareHologramVideo を呼ぶため両方に同梱する。
    "/api/movies": RUNTIME_ASSET_GLOBS,
    "/api/movies/[id]": RUNTIME_ASSET_GLOBS,
    "/api/health": RUNTIME_ASSET_GLOBS,
  },
};

export default nextConfig;

