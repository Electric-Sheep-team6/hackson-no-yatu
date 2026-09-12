import { describe, expect, it } from "vitest";

import {
  buildFfmpegArgs,
  buildFilterComplex,
  escapeFilterPath,
  sanitizeDrawtext,
  wrapJapaneseText,
  type BuildFfmpegArgsInput,
} from "@/lib/ai/video/composeMovie";

function createInput(overrides: Partial<BuildFfmpegArgsInput> = {}): BuildFfmpegArgsInput {
  return {
    scenePaths: ["/tmp/scene-1.mp4", "/tmp/scene-2.mp4", "/tmp/scene-3.mp4"],
    fontPath: "/tmp/NotoSansJP-Bold.ttf",
    textFilePaths: [
      "/tmp/title.txt",
      "/tmp/logline.txt",
      "/tmp/narration-1.txt",
      "/tmp/narration-2.txt",
      "/tmp/narration-3.txt",
    ],
    title: "僕だけの予告編",
    logline: "これは偏愛を映像にする物語",
    narrations: ["最初のナレーションです", "二番目のナレーションです", "最後のナレーションです"],
    outputPath: "/tmp/output.mp4",
    ...overrides,
  };
}

describe("sanitizeDrawtext", () => {
  it("改行と制御文字を除去する", () => {
    expect(sanitizeDrawtext("こんにちは\n世界\r\u0000テスト", 100)).toBe("こんにちは 世界テスト");
  });

  it("指定文字数を超える文字を切り捨てる", () => {
    expect(sanitizeDrawtext("あいうえおかきくけこさしすせそ", 10)).toBe("あいうえおかきくけこ");
  });

  it("サロゲートペアを途中で壊さない", () => {
    expect(sanitizeDrawtext("😀😀😀", 2)).toBe("😀😀");
  });
});

describe("wrapJapaneseText", () => {
  it("10文字ごとに最大2行へ折り返す", () => {
    expect(wrapJapaneseText("あいうえおかきくけこさしすせそたちつてと", 10)).toBe(
      "あいうえおかきくけこ\nさしすせそたちつてと",
    );
  });

  it("3行目以降を切り捨てる", () => {
    expect(wrapJapaneseText("123456789012345678901234567890", 10)).toBe("1234567890\n1234567890");
  });

  it("10〜12文字以外を拒否する", () => {
    expect(() => wrapJapaneseText("テスト", 9)).toThrow(RangeError);
    expect(() => wrapJapaneseText("テスト", 13)).toThrow(RangeError);
  });
});

describe("escapeFilterPath", () => {
  it("コロン・バックスラッシュ・シングルクォートをエスケープする", () => {
    expect(escapeFilterPath("C:\\fonts\\it's.ttf")).toBe("C\\:\\\\fonts\\\\it\\'s.ttf");
  });
});

describe("buildFilterComplex", () => {
  it("5区間をconcatする", () => {
    expect(buildFilterComplex(createInput())).toContain("concat=n=5:v=1:a=0[outv]");
  });

  it("すべての映像をyuv420pかつSAR=1へ揃える", () => {
    expect(buildFilterComplex(createInput())).toContain("format=yuv420p,setsar=1");
  });

  it("シーン1の0.4秒トランジションを含む", () => {
    const filter = buildFilterComplex(createInput());
    expect(filter).toContain("trim=start=0:end=4.9");
    expect(filter).toContain("fade=t=out:st=4.5:d=0.4");
  });

  it("シーン3の後に0.5秒の黒を追加する", () => {
    expect(buildFilterComplex(createInput())).toContain(
      "tpad=stop_mode=add:stop_duration=0.5:color=black",
    );
  });

  it("drawtext本文をfilter文字列へ直接埋め込まない", () => {
    const input = createInput({
      title: "絶対に入れてはならない語", // 10文字以内=1行想定
      logline: "絶対にFILTERへ入れてはいけない本文",
    });
    const filter = buildFilterComplex(input);
    expect(filter).not.toContain(input.title);
    expect(filter).not.toContain(input.logline);
    expect(filter).toContain("textfile=");
  });

  it("fontfileを明示する", () => {
    expect(buildFilterComplex(createInput())).toContain("fontfile='/tmp/NotoSansJP-Bold.ttf'");
  });

  it("字幕の安全領域用x式を使用する", () => {
    expect(buildFilterComplex(createInput())).toContain(
      "max(200\\,min(520-text_w\\,(w-text_w)/2))",
    );
  });

  it("冒頭タイトルが2行になる場合は24pxへ縮小する", () => {
    const filter = buildFilterComplex(createInput({ title: "123456789012345" }));
    expect(filter).toContain("fontsize=24");
  });

  it("終盤カードでtitleとloglineがともに2行でも別y座標になる", () => {
    const filter = buildFilterComplex(
      createInput({
        title: "123456789012345",
        logline: "1234567890123456789012345678901234567890",
      }),
    );
    expect(filter).toContain(":y=440");
    expect(filter).toContain(":y=480");
  });
});

describe("buildFfmpegArgs", () => {
  it("3本の動画と2本のlavfi背景を入力する", () => {
    const args = buildFfmpegArgs(createInput());
    expect(args.filter((value) => value === "-i")).toHaveLength(5);
  });

  it("タイトル背景を2.5秒で生成する", () => {
    expect(buildFfmpegArgs(createInput())).toContain("color=c=black:s=720x720:r=24:d=2.5");
  });

  it("終盤カード背景を3.3秒で生成する", () => {
    expect(buildFfmpegArgs(createInput())).toContain("color=c=black:s=720x720:r=24:d=3.3");
  });

  it("filter_complexを1個だけ使用する", () => {
    const args = buildFfmpegArgs(createInput());
    expect(args.filter((value) => value === "-filter_complex")).toHaveLength(1);
  });

  it("要求されたH.264出力設定を使用する", () => {
    expect(buildFfmpegArgs(createInput())).toEqual(
      expect.arrayContaining([
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-r", "24", "-preset", "veryfast", "-movflags", "+faststart",
      ]),
    );
  });

  it("concat出力だけをmapする", () => {
    const args = buildFfmpegArgs(createInput());
    expect(args[args.indexOf("-map") + 1]).toBe("[outv]");
  });

  it("-yをglobal optionとして先頭に置く", () => {
    expect(buildFfmpegArgs(createInput())[0]).toBe("-y");
  });

  it("シーン数が不正なら失敗する", () => {
    expect(() =>
      buildFfmpegArgs(createInput({ scenePaths: ["/tmp/a.mp4", "/tmp/b.mp4"] })),
    ).toThrow("scenePaths は3本必要です");
  });
});
