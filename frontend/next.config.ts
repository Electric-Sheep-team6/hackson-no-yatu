import type { NextConfig } from "next";

const FFMPEG_BINARY_PATH = "./node_modules/ffmpeg-static/ffmpeg";

const nextConfig: NextConfig = {
  // composeMovie.ts / prepareHologramVideo.ts は複数のRoute Handlerから
  // 呼ばれうるため、全サーバールートのtraceにFFmpegバイナリを含める。
  outputFileTracingIncludes: {
    "/*": [FFMPEG_BINARY_PATH],
  },
};

export default nextConfig;
