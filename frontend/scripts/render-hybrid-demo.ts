import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { composeHybridMovie, composeMemoryMontage } from "../lib/ai/video/composeHybridMovie";

async function main() {
  const photoDirectory = resolve(process.argv[2] ?? "");
  const aiVideoPath = resolve(process.argv[3] ?? "");
  const outputPath = resolve(process.argv[4] ?? "hybrid-demo.mp4");
  const planPath = process.argv[5] ? resolve(process.argv[5]) : undefined;
  if (!process.argv[2] || !process.argv[3]) {
    throw new Error("usage: render-hybrid-demo <photo-directory> <ai-video> [output.mp4]");
  }
  const names = (await readdir(photoDirectory))
    .filter((name) => /\.(jpe?g|png|webp)$/iu.test(name))
    .toSorted()
    .slice(0, 26);
  if (names.length !== 26) throw new Error(`写真は26枚必要です（検出: ${names.length}枚）`);
  const plan = planPath
      ? JSON.parse(await readFile(planPath, "utf8")) as {
          title: string;
          logline: string;
          chapterLines: string[];
          photoOrder?: number[];
          motifs?: { name: string }[];
        }
    : undefined;
  const orderedNames = plan?.photoOrder?.map((number) => names[number - 1]).filter(Boolean) ?? names;
  const photos = await Promise.all(orderedNames.map(async (name, index) => ({
    number: index + 1,
    data: new Uint8Array(await readFile(join(photoDirectory, name))),
  })));
  const memory = await composeMemoryMontage(photos, [], 180_000);
  const movie = await composeHybridMovie(
    memory,
    new Uint8Array(await readFile(aiVideoPath)),
    {
      title: plan?.title ?? "高橋という映画",
      logline: plan?.logline ?? "記録された時間が、未来を追い越す。",
      chapterLines: plan?.chapterLines ?? ["すべては、記録から始まった", "その瞬間、運命が走り出す", "記憶は、次の誰かへ続いていく"],
      motifs: plan?.motifs,
    },
    180_000,
  );
  await writeFile(outputPath, movie);
  console.log(JSON.stringify({ outputPath, photoCount: photos.length, bytes: movie.byteLength }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
