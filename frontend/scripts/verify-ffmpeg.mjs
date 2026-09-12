import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not install a binary");
}

try {
  await access(ffmpegPath, constants.X_OK);
} catch {
  throw new Error(`ffmpeg-static binary is not executable: ${ffmpegPath}`);
}

console.log(`Using FFmpeg binary: ${ffmpegPath}`);
