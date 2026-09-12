import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { composeHybridMovie, composeMemoryMontage } from "@/lib/ai/video/composeHybridMovie";

const enabled = process.env.RUN_HYBRID_FIXTURE === "1";

describe.skipIf(!enabled)("hybrid composer fixture", () => {
  it("26枚の写真と1本のAI動画を規定範囲の60.5秒へレンダーする", async () => {
    const photoDirectory = process.env.HYBRID_PHOTO_DIR!;
    const aiPath = process.env.HYBRID_AI_VIDEO!;
    const outputPath = process.env.HYBRID_OUTPUT!;
    const names = (await readdir(photoDirectory)).filter((name) => /\.(jpe?g|png|webp)$/iu.test(name)).toSorted();
    expect(names).toHaveLength(26);
    const plan = process.env.HYBRID_PLAN
      ? JSON.parse(await readFile(process.env.HYBRID_PLAN, "utf8")) as {
          title: string;
          logline: string;
          chapterLines: string[];
          photoOrder: number[];
          motifs?: { name: string }[];
        }
      : undefined;
    const orderedNames = plan?.photoOrder.map((number) => names[number - 1]) ?? names;
    const photos = await Promise.all(orderedNames.map(async (name, index) => ({
      number: index + 1,
      data: new Uint8Array(await readFile(join(photoDirectory, name))),
    })));
    const memoryVideos = process.env.HYBRID_MEMORY_VIDEO
      ? [{ data: new Uint8Array(await readFile(process.env.HYBRID_MEMORY_VIDEO)) }]
      : [];
    const memory = await composeMemoryMontage(photos, memoryVideos, 180_000);
    const final = await composeHybridMovie(
      memory,
      new Uint8Array(await readFile(aiPath)),
      {
        title: plan?.title ?? "高橋という映画",
        logline: plan?.logline ?? "記録された時間が、未来を追い越す。",
        chapterLines: plan?.chapterLines ?? ["すべては、記録から始まった", "その瞬間、運命が走り出す", "記憶は、次の誰かへ続いていく"],
        motifs: plan?.motifs,
      },
      180_000,
    );
    await writeFile(outputPath, final);
    expect(final.byteLength).toBeGreaterThan(100_000);
  }, 370_000);
});
