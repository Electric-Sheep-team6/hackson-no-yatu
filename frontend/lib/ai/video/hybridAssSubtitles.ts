import { sanitizeAssText, wrapAssText } from "./assSubtitles";

const FONT_NAME = "Noto Sans JP";

const HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: MainTitle,${FONT_NAME},46,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,2,0,1,1.4,1.2,5,150,150,0,1
Style: Chapter,${FONT_NAME},27,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,2,0,3,1,0,2,170,170,92,1
Style: Devotion,${FONT_NAME},29,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,2,0,3,1,0,8,150,150,92,1
Style: Motif,${FONT_NAME},34,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,2,0,1,1.4,1.2,2,160,160,96,1
Style: EndTitle,${FONT_NAME},43,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,2,0,1,1.4,1.4,5,145,145,0,1
Style: EndLine,${FONT_NAME},23,&H00E8E8E8,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,2,0,1,1.2,1.2,2,150,150,118,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

export type HybridSubtitleDescription = {
  title: string;
  logline: string;
  chapterLines: readonly string[];
  motifs?: readonly { name: string }[];
};

function text(value: string, max: number, perLine: number, lines = 2): string {
  return wrapAssText(sanitizeAssText(value, max), perLine, lines);
}

function event(start: string, end: string, style: string, value: string, tags: string): string {
  return `Dialogue: 0,${start},${end},${style},,0,0,0,,{${tags}}${value}`;
}

/** 全編テロップを避け、物語の転換点だけに短い言葉を置く。 */
export function buildHybridAssSubtitles(movie: HybridSubtitleDescription): string {
  const chapters = [
    movie.chapterLines[0] ?? "すべては、記録から始まった。",
    movie.chapterLines[1] ?? "その瞬間が、運命を変える。",
    movie.chapterLines[2] ?? "最後に残るのは、誰の記憶か。",
  ];
  const motifs = [movie.motifs?.[0]?.name ?? "愛したもの", movie.motifs?.[1]?.name ?? "残したもの"];
  const events = [
    event("0:00:00.35", "0:00:03.30", "MainTitle", text(movie.title, 15, 8), "\\fad(650,500)\\blur0.4"),
    event("0:00:11.40", "0:00:14.20", "Chapter", text(chapters[0], 30, 15), "\\fad(250,450)"),
    event("0:00:27.00", "0:00:29.55", "Chapter", text(chapters[1], 30, 15), "\\fad(200,450)"),
    event("0:00:30.20", "0:00:32.70", "Devotion", text("これは、彼が愛したもの。", 20, 10), "\\fad(250,450)"),
    event("0:00:32.70", "0:00:35.70", "Motif", text(motifs[0], 20, 10), "\\fad(200,400)"),
    event("0:00:38.30", "0:00:41.40", "Motif", text(motifs[1], 20, 10), "\\fad(200,400)"),
    event("0:00:45.00", "0:00:47.70", "Chapter", text(chapters[2], 30, 15), "\\fad(200,500)"),
    event("0:00:55.60", "0:01:00.20", "EndTitle", text(movie.title, 15, 8), "\\fad(650,700)\\blur0.4"),
    event("0:00:56.60", "0:01:00.20", "EndLine", text(movie.logline, 40, 20), "\\fad(650,700)"),
  ];
  return `${HEADER}\n${events.join("\n")}\n`;
}
