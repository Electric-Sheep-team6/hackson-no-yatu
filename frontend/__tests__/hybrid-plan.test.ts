import { describe, expect, it } from "vitest";

import {
  AI_DURATION_SECONDS,
  buildProductionHeroPrompt,
  HYBRID_DURATION_SECONDS,
  MEMORY_DURATION_SECONDS,
  normalizeHybridMoviePlan,
} from "@/lib/ai/generateHybridMoviePlan";
import { buildMemoryTimelineLabels, deduplicateMemoryPhotos } from "@/lib/ai/video/composeHybridMovie";

describe("normalizeHybridMoviePlan", () => {
  it("AIの順序から重複と範囲外を除き、26枚を欠落なく補完する", () => {
    const plan = normalizeHybridMoviePlan({
      title: "軌跡の彼方へ",
      logline: "記録が未来を動かす。",
      synopsis: "記録をたどる予告編",
      photoOrder: [3, 1, 3, 26],
      heroPrompt: "Three shots of light and weather without people.",
      motifs: [
        { name: "軽トラック", count: 2, evidencePhotoNumbers: [4, 4, 8], objectDescription: "白い小型トラック", imagePrompt: "A white kei truck." },
        { name: "花火", count: 1, evidencePhotoNumbers: [3], objectDescription: "手持ち花火", imagePrompt: "An unlit sparkler." },
      ],
      chapterLines: ["始まり", "転換", "未来"],
    }, 26);

    expect(plan.photoOrder.slice(0, 3)).toEqual([3, 1, 26]);
    expect(plan.photoOrder).toHaveLength(26);
    expect(new Set(plan.photoOrder).size).toBe(26);
    expect(plan.photoOrder.toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: 26 }, (_, index) => index + 1),
    );
    expect(plan.motifs[0]).toMatchObject({ name: "軽トラック", count: 2, evidencePhotoNumbers: [4, 8] });
  });

  it("AI動画へ実写撮影条件とAIらしい破綻の禁止条件を強制する", () => {
    const prompt = buildProductionHeroPrompt("A symbolic road and a keepsake.");
    expect(prompt).toContain("exactly two grounded live-action studio turntable shots");
    expect(prompt).toContain("ARRI Alexa 35");
    expect(prompt).toContain("real-world physics");
    expect(prompt).toContain("No people");
    expect(prompt).toContain("A symbolic road and a keepsake.");
  });

  it("タイムラインで各写真を一度だけ使い、冒頭と5箇所に黒画面を置く", () => {
    const timeline = buildMemoryTimelineLabels(26, 0);
    expect(timeline.labels[0]).toBe("[black0]");
    expect(timeline.blackGapCount).toBe(5);
    for (let index = 0; index < 26; index += 1) {
      expect(timeline.labels.filter((label) => label === `[p${index}]`)).toHaveLength(1);
    }
  });

  it("内容が同じ写真はレコード番号が違っても一度だけ使う", () => {
    const photos = deduplicateMemoryPhotos([
      { number: 1, data: new Uint8Array([1, 2, 3]) },
      { number: 2, data: new Uint8Array([4, 5, 6]) },
      { number: 3, data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(photos.map(({ number }) => number)).toEqual([1, 2]);
  });

  it("黒画面を追加しても素材比率75対25と50秒以上65秒未満を守る", () => {
    expect(MEMORY_DURATION_SECONDS / (MEMORY_DURATION_SECONDS + AI_DURATION_SECONDS)).toBe(0.75);
    expect(HYBRID_DURATION_SECONDS).toBeGreaterThanOrEqual(50);
    expect(HYBRID_DURATION_SECONDS).toBe(60.5);
    expect(HYBRID_DURATION_SECONDS).toBeLessThan(65);
  });
});
