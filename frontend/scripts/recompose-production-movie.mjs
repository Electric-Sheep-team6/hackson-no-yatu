import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { createClient } from "@supabase/supabase-js";

import { buildAssSubtitles } from "../lib/ai/video/assSubtitles.ts";

const execFileAsync = promisify(execFile);

function escapeFilterPath(path) {
  return path.replace(/\\/gu, "\\\\").replace(/:/gu, "\\:").replace(/'/gu, "\\'");
}

function buildFfmpegArgs({ scenePaths, assPath, fontsDirectory, outputPath }) {
  const common = "fps=24,format=yuv420p,setsar=1";
  const filter = [
    "[3:v]format=yuv420p,setsar=1[intro]",
    `[0:v]trim=start=0:end=4.9,setpts=PTS-STARTPTS,${common},fade=t=in:st=0:d=0.3,fade=t=out:st=4.5:d=0.4[scene1]`,
    `[1:v]trim=start=0:end=4,setpts=PTS-STARTPTS,${common},fade=t=in:st=0:d=0.3,fade=t=out:st=3.7:d=0.3[scene2]`,
    `[2:v]trim=start=0:end=3,setpts=PTS-STARTPTS,${common},fade=t=in:st=0:d=0.3,fade=t=out:st=2.7:d=0.3,tpad=stop_mode=add:stop=12:color=black[scene3]`,
    "[4:v]format=yuv420p,setsar=1[endcard]",
    "[intro][scene1][scene2][scene3][endcard]concat=n=5:v=1:a=0[base]",
    `[base]ass=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(fontsDirectory)}'[outv]`,
  ].join(";");
  return [
    "-y",
    ...scenePaths.flatMap((path) => ["-i", path]),
    "-f", "lavfi", "-i", "color=c=black:s=720x720:r=24:d=2.5",
    "-f", "lavfi", "-i", "color=c=black:s=720x720:r=24:d=3.3",
    "-filter_complex", filter,
    "-map", "[outv]", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-r", "24", "-video_track_timescale", "24000", "-preset", "veryfast",
    "-movflags", "+faststart", outputPath,
  ];
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function main() {
  const [movieId, requestedOutputPath] = process.argv.slice(2);
  if (!movieId || !requestedOutputPath) {
    throw new Error(
      "Usage: node --env-file=.env.local scripts/recompose-production-movie.mjs <movie-id> <output-path>",
    );
  }
  const outputPath = resolve(requestedOutputPath);
  const supabase = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: movie, error: movieError } = await supabase
    .from("movies")
    .select("id, status, video_path, movie_json")
    .eq("id", movieId)
    .single();
  if (movieError) throw movieError;
  if (movie.status !== "completed" || !movie.video_path) {
    throw new Error("Movie is not a completed production artifact");
  }
  const generatedScenes = movie.movie_json?.generatedScenes ?? [];
  const scenePaths = generatedScenes
    .filter((scene) => scene.status === "succeeded" && scene.path)
    .toSorted((a, b) => a.order - b.order)
    .map((scene) => scene.path);
  if (scenePaths.length !== 3 || movie.movie_json?.scenes?.length !== 3) {
    throw new Error("Movie does not have exactly three successful scenes");
  }

  const directory = await mkdtemp(resolve(".tmp-recompose-production-movie-"));
  try {
    const localScenePaths = await Promise.all(scenePaths.map(async (storagePath, index) => {
      const { data, error } = await supabase.storage.from("movies").download(storagePath);
      if (error) throw error;
      const path = join(directory, `scene-${index + 1}.mp4`);
      await writeFile(path, new Uint8Array(await data.arrayBuffer()));
      return path;
    }));
    const assPath = join(directory, "movie.ass");
    const localOutputPath = join(directory, "output.mp4");
    await writeFile(assPath, buildAssSubtitles({
      title: movie.movie_json.title,
      logline: movie.movie_json.logline,
      scenes: movie.movie_json.scenes.map(({ narration }) => ({ narration })),
    }), "utf8");
    const containerDirectory = `/workspace/${relative(process.cwd(), directory)}`;
    const containerArgs = buildFfmpegArgs({
      scenePaths: localScenePaths.map((_, index) =>
        `${containerDirectory}/scene-${index + 1}.mp4`,
      ),
      assPath: `${containerDirectory}/movie.ass`,
      fontsDirectory: "/workspace/vendor/fonts",
      outputPath: `${containerDirectory}/output.mp4`,
    });
    await execFileAsync("docker", [
      "run", "--rm", "--platform", "linux/amd64",
      "-v", `${process.cwd()}:/workspace`, "-w", "/workspace",
      "node:22-bookworm-slim", "/workspace/vendor/ffmpeg/ffmpeg",
      ...containerArgs,
    ], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
    const video = await readFile(localOutputPath);
    const { error: uploadError } = await supabase.storage
      .from("movies")
      .upload(movie.video_path, video, { contentType: "video/mp4", upsert: true });
    if (uploadError) throw uploadError;
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, video);
    process.stdout.write(`${JSON.stringify({ movieId, status: "recomposed", bytes: video.byteLength })}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
