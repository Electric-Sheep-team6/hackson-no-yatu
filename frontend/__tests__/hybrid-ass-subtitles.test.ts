import { describe, expect, it } from "vitest";

import { buildHybridAssSubtitles } from "@/lib/ai/video/hybridAssSubtitles";

describe("hybrid ASS subtitles", () => {
  const ass = buildHybridAssSubtitles({
    title: "僕らが駆け抜けた日々",
    logline: "記憶は未来へ続いていく。",
    chapterLines: ["始まり", "時間が力になる", "未来へ"],
    motifs: [{ name: "軽トラック" }, { name: "花火" }],
  });

  it("すべての字幕スタイルを同梱Noto Sans JPへ統一する", () => {
    const styles = ass.split("\n").filter((line) => line.startsWith("Style:"));
    expect(styles.length).toBeGreaterThan(1);
    expect(styles.every((line) => line.includes(",Noto Sans JP,"))).toBe(true);
  });

  it("偏愛章の意図と上位2モチーフを明示する", () => {
    expect(ass.replaceAll("\\N", "")).toContain("これは、彼が愛したもの。");
    expect(ass).toContain("軽トラック");
    expect(ass).toContain("花火");
  });
});
