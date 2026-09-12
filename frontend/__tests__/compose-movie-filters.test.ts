import { describe, expect, it } from "vitest";

import { buildAssSubtitles, sanitizeAssText, wrapAssText } from "@/lib/ai/video/assSubtitles";
import {
  buildFfmpegArgs,
  buildFilterComplex,
  escapeFilterPath,
  type BuildFfmpegArgsInput,
} from "@/lib/ai/video/composeMovie";

function createInput(overrides: Partial<BuildFfmpegArgsInput> = {}): BuildFfmpegArgsInput {
  return {
    scenePaths: ["/tmp/scene-1.mp4", "/tmp/scene-2.mp4", "/tmp/scene-3.mp4"],
    assPath: "/tmp/movie.ass",
    fontsDirectory: "/tmp/fonts",
    outputPath: "/tmp/output.mp4",
    ...overrides,
  };
}

const movie = {
  title: "僕だけの予告編",
  logline: "これは偏愛を映像にする物語",
  scenes: [
    { narration: "最初のナレーションです" },
    { narration: "二番目のナレーションです" },
    { narration: "最後のナレーションです" },
  ],
};

describe("sanitizeAssText", () => {
  it("改行と制御文字を除去する", () => {
    expect(sanitizeAssText("こんにちは\n世界\r\u0000テスト", 100)).toBe("こんにちは 世界テスト");
  });

  it("ASS制御記号を表示用文字へ変換する", () => {
    expect(sanitizeAssText("{\\fad(1,1)}", 100)).toBe("｛＼fad(1,1)｝");
  });

  it("指定文字数をコードポイント単位で切る", () => {
    expect(sanitizeAssText("😀😀😀", 2)).toBe("😀😀");
  });
});

describe("buildAssSubtitles", () => {
  it("720x720とNoto Sans JPを指定する", () => {
    const ass = buildAssSubtitles(movie);
    expect(ass).toContain("PlayResX: 720");
    expect(ass).toContain("PlayResY: 720");
    expect(ass).toContain("Noto Sans JP");
  });

  it("安全領域と中央揃えをStyleで指定する", () => {
    const ass = buildAssSubtitles(movie);
    expect(ass).toContain(",8,200,200,448,1");
    expect(ass).toContain(",8,200,200,448,1");
  });

  it("確定タイムラインの6イベントを出力する", () => {
    const dialogues = buildAssSubtitles(movie)
      .split("\n")
      .filter((line) => line.startsWith("Dialogue:"));
    expect(dialogues).toHaveLength(6);
    expect(dialogues).toEqual(expect.arrayContaining([
      expect.stringContaining("0:00:00.00,0:00:02.50,Intro"),
      expect.stringContaining("0:00:02.50,0:00:07.00,Subtitle"),
      expect.stringContaining("0:00:07.40,0:00:11.40,Subtitle"),
      expect.stringContaining("0:00:11.40,0:00:14.40,Subtitle"),
      expect.stringContaining("0:00:14.90,0:00:18.20,EndTitle"),
      expect.stringContaining("0:00:14.90,0:00:18.20,EndLogline"),
    ]));
  });

  it("文字のフェードを0.3秒に固定する", () => {
    expect(buildAssSubtitles(movie)).toContain("{\\fad(300,300)}");
  });

  it("中央字幕は30文字までを最大3行で保持する", () => {
    const ass = buildAssSubtitles({
      ...movie,
      scenes: [{ narration: "1234567890123456789012345" }, ...movie.scenes.slice(1)],
    });
    expect(ass).toContain("1234567890\\N1234567890\\N12345");
  });
});

describe("wrapAssText", () => {
  it("ASS標準の改行で最大2行へ分ける", () => {
    expect(wrapAssText("1234567890123456789012345", 10))
      .toBe("1234567890\\N1234567890");
  });
});

describe("escapeFilterPath", () => {
  it("コロン・バックスラッシュ・シングルクォートをエスケープする", () => {
    expect(escapeFilterPath("C:\\fonts\\it's.ass")).toBe("C\\:\\\\fonts\\\\it\\'s.ass");
  });
});

describe("buildFilterComplex", () => {
  it("5区間を結合してからASSを1回適用する", () => {
    const filter = buildFilterComplex(createInput());
    expect(filter).toContain("concat=n=5:v=1:a=0[base]");
    expect(filter).toContain("[base]ass=filename='/tmp/movie.ass':fontsdir='/tmp/fonts'[outv]");
    expect(filter.match(/ass=/gu)).toHaveLength(1);
  });

  it("drawtextとユーザー本文をfilter文字列へ含めない", () => {
    const filter = buildFilterComplex(createInput());
    expect(filter).not.toContain("drawtext");
    expect(filter).not.toContain(movie.title);
  });

  it("映像をyuv420pかつSAR=1へ揃える", () => {
    const filter = buildFilterComplex(createInput());
    expect(filter).toContain("format=yuv420p,setsar=1");
    expect(filter.match(/fps=24/gu)).toHaveLength(3);
  });

  it("確定済みのシーン1トランジションと終端黒を維持する", () => {
    const filter = buildFilterComplex(createInput());
    expect(filter).toContain("trim=start=0:end=4.9");
    expect(filter).toContain("fade=t=out:st=4.5:d=0.4");
    expect(filter).toContain("tpad=stop_mode=add:stop=12:color=black");
  });
});

describe("buildFfmpegArgs", () => {
  it("3動画と2つの黒背景を入力する", () => {
    expect(buildFfmpegArgs(createInput()).filter((value) => value === "-i")).toHaveLength(5);
  });

  it("単一filter_complexと要求されたH.264設定を使う", () => {
    const args = buildFfmpegArgs(createInput());
    expect(args.filter((value) => value === "-filter_complex")).toHaveLength(1);
    expect(args).toEqual(expect.arrayContaining([
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "24",
      "-video_track_timescale", "24000", "-preset", "veryfast", "-movflags", "+faststart",
    ]));
    expect(args[args.indexOf("-map") + 1]).toBe("[outv]");
    expect(args[0]).toBe("-y");
  });

  it("シーン数が不正なら失敗する", () => {
    expect(() => buildFfmpegArgs(createInput({ scenePaths: ["/tmp/a.mp4"] })))
      .toThrow("scenePaths は3本必要です");
  });
});
