import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // ffmpeg-static downloads a platform binary during npm install. Include the
    // package directory (rather than only its JS entry point) in the serverless
    // trace so Vercel can execute the binary at runtime.
    "/api/movies": ["./node_modules/ffmpeg-static/**/*"],
  },
};

export default nextConfig;
