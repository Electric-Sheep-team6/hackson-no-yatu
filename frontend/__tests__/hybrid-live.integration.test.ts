import { createServer } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildProductionHeroPrompt, generateHybridMoviePlan } from "@/lib/ai/generateHybridMoviePlan";
import { generateGeminiMotifImage } from "@/lib/ai/image/geminiImageGenerator";
import { beginMovieImageCache } from "@/lib/ai/referenceImage";
import { geminiVideoGenerator } from "@/lib/ai/video/geminiVideoGenerator";

const enabled = process.env.RUN_GEMINI_LIVE === "1";

describe.skipIf(!enabled)("Gemini hybrid live workflow", () => {
  let baseUrl = "";
  let closeServer: (() => Promise<void>) | undefined;
  const photoDirectory = process.env.HYBRID_PHOTO_DIR!;
  const outputDirectory = process.env.HYBRID_OUTPUT_DIR!;
  const outputPrefix = process.env.HYBRID_OUTPUT_PREFIX ?? "08";

  beforeAll(async () => {
    const server = createServer(async (request, response) => {
      const name = request.url?.slice(1) ?? "";
      if (!/^photo_\d{2}\.jpg$/u.test(name)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "image/jpeg" });
      response.end(await readFile(join(photoDirectory, name)));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture serverを開始できませんでした");
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  afterAll(async () => closeServer?.());

  it("26枚を構成し、象徴動画を一度だけ生成する", async () => {
    const names = (await readdir(photoDirectory)).filter((name) => /^photo_\d{2}\.jpg$/u.test(name)).toSorted();
    expect(names).toHaveLength(26);
    const photoUrls = names.map((name) => `${baseUrl}/${name}`);
    beginMovieImageCache();
    const plan = await generateHybridMoviePlan({
      obsession: {
        title: "高橋という人の記録",
        reason: "幼少期から現在まで、人との時間と挑戦の瞬間が繰り返し残されている。",
        keywords: ["成長", "仲間", "挑戦", "記憶"],
        emotion: ["懐かしさ", "高揚", "希望"],
        evidence: [{ sourceType: "photo", summary: "一人の人物の成長と周囲の人々が26枚に記録されている" }],
        visualMotifs: ["家族", "祝祭", "旅", "自然", "仲間"],
      },
      photoUrls,
    });
    const motifImages = await Promise.all(plan.motifs.map(generateGeminiMotifImage));
    const generated = await geminiVideoGenerator.generateScene({
      prompt: buildProductionHeroPrompt(plan.heroPrompt),
      duration: 10,
      referenceImageUrls: motifImages.map((image) =>
        `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
      ),
    });
    expect(generated.videoData?.byteLength).toBeGreaterThan(100_000);
    await Promise.all([
      writeFile(join(outputDirectory, `${outputPrefix}_hybrid_plan.json`), JSON.stringify(plan, null, 2)),
      writeFile(join(outputDirectory, `${outputPrefix}_ai_symbolic.mp4`), generated.videoData!),
      ...motifImages.map((image, index) =>
        writeFile(join(outputDirectory, `${outputPrefix}_motif_${index + 1}.jpg`), image.data),
      ),
    ]);
  }, 210_000);
});
