import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { resolveFfmpegPath, resolveFontPath } from "./runtimeAssets";

const execFileAsync = promisify(execFile);

/**
 * 動画全体の固定仕様（720×720 / 24fps / 音声なし）。
 */
export const VIDEO_SIZE = 720;
export const VIDEO_FPS = 24;
export const VIDEO_PIXEL_FORMAT = "yuv420p";

const DEFAULT_FONT_SIZE = 32;
const COMPACT_TITLE_FONT_SIZE = 24;

const TEXT_WRAP_CHARACTERS = 10;
const TEXT_MAX_LINES = 2;
const TEXT_MAX_CHARACTERS = TEXT_WRAP_CHARACTERS * TEXT_MAX_LINES;

// 安全マージン: 実機で円形クロップを確認済みの範囲（x200〜520 / y440〜520）。
const TEXT_SAFE_X_MIN = 200;
const TEXT_SAFE_X_MAX = 520;

const SUBTITLE_Y = 448;
const SUBTITLE_LINE_SPACING = 8;

const INTRO_CENTER_Y = 480;

// 終盤カードの安全領域。title / logline の行数に応じて440〜520pxへ収める。
const END_CARD_ONE_ONE_TITLE_Y = 448;
const END_CARD_ONE_ONE_LOGLINE_Y = 488;

const END_CARD_TWO_ONE_TITLE_Y = 440;
const END_CARD_TWO_ONE_LOGLINE_Y = 496;

const END_CARD_ONE_TWO_TITLE_Y = 440;
const END_CARD_ONE_TWO_LOGLINE_Y = 480;

const END_CARD_TWO_TWO_TITLE_Y = 440;
const END_CARD_TWO_TWO_LOGLINE_Y = 480;

const DEFAULT_LINE_SPACING = 4;
const COMPACT_LINE_SPACING = -4;

export const TITLE_CARD_DURATION = 2.5;
const TITLE_FADE_DURATION = 0.3;

const SCENE_1_VISIBLE_DURATION = 4.5;
const SCENE_1_TRANSITION_DURATION = 0.4;
const SCENE_1_INPUT_DURATION = SCENE_1_VISIBLE_DURATION + SCENE_1_TRANSITION_DURATION;

const SCENE_2_DURATION = 4.0;
const SCENE_3_DURATION = 3.0;
const SCENE_3_BLACK_DURATION = 0.5;

const SCENE_FADE_DURATION = 0.3;

export const END_CARD_DURATION = 3.3;

export const OUTPUT_DURATION = 18.2;

const FFMPEG_MAX_BUFFER = 10 * 1_024 * 1_024;

const SCENE_COUNT = 3;
const CONCAT_SEGMENT_COUNT = 5;

const TITLE_INPUT_INDEX = 3;
const END_CARD_INPUT_INDEX = 4;

const TITLE_TEXT_INDEX = 0;
const LOGLINE_TEXT_INDEX = 1;
const FIRST_NARRATION_TEXT_INDEX = 2;

const TEXT_FILE_NAMES = [
  "title.txt",
  "logline.txt",
  "narration-1.txt",
  "narration-2.txt",
  "narration-3.txt",
] as const;

const SCENE_FILE_NAMES = ["scene-1.mp4", "scene-2.mp4", "scene-3.mp4"] as const;

const OUTPUT_FILE_NAME = "output.mp4";

/**
 * drawtext の x 座標。10〜12文字×32px程度を想定し、左端200〜右端520の
 * 安全領域へ収める。FFmpegの式中のカンマはfilter separatorと解釈されない
 * ようエスケープする。
 */
const DRAW_X_EXPRESSION =
  `max(${TEXT_SAFE_X_MIN}\\,` + `min(${TEXT_SAFE_X_MAX}-text_w\\,(w-text_w)/2))`;

/** 確定タイムライン（秒）。ドキュメント代わりに実装へ残す。 */
export const MOVIE_TIMELINE = Object.freeze({
  title: Object.freeze({ start: 0, end: 2.5 }),
  scene1: Object.freeze({ start: 2.5, end: 7.0 }),
  scene1FadeToBlack: Object.freeze({ start: 7.0, end: 7.4 }),
  scene2: Object.freeze({ start: 7.4, end: 11.4 }),
  scene3: Object.freeze({ start: 11.4, end: 14.4 }),
  black: Object.freeze({ start: 14.4, end: 14.9 }),
  endCard: Object.freeze({ start: 14.9, end: 18.2 }),
});

export interface MovieDescription {
  readonly title: string;
  readonly logline: string;
  readonly scenes: readonly { readonly narration: string }[];
}

export interface BuildFfmpegArgsInput {
  readonly scenePaths: readonly string[];
  readonly fontPath: string;
  readonly textFilePaths: readonly string[];
  readonly title: string;
  readonly logline: string;
  readonly narrations: readonly string[];
  readonly outputPath: string;
}

interface DrawtextOptions {
  readonly textFilePath: string;
  readonly fontPath: string;
  readonly y: number;
  readonly fontSize?: number;
  readonly lineSpacing?: number;
  readonly enableUntil?: number;
}

/**
 * drawtextに渡すユーザー入力から、制御文字・改行を除去して最大文字数へ丸める。
 * Array.from()を使うことでUTF-16のコード単位ではなくUnicodeコードポイント単位で切る。
 */
export function sanitizeDrawtext(value: string, maxCharacters = TEXT_MAX_CHARACTERS): string {
  const withoutNewlines = value.replace(/[\r\n\u2028\u2029]+/gu, " ");
  const withoutControls = withoutNewlines.replace(/\p{Cc}/gu, "");
  const normalized = withoutControls.replace(/\s+/gu, " ").trim();
  return Array.from(normalized).slice(0, maxCharacters).join("");
}

/**
 * 日本語向けに文字数だけで機械的に折り返す。単語境界・禁則処理は行わない。
 * 最大2行を超えた文字は切り捨てる。
 */
export function wrapJapaneseText(value: string, charactersPerLine = TEXT_WRAP_CHARACTERS): string {
  if (charactersPerLine < 10 || charactersPerLine > 12) {
    throw new RangeError("charactersPerLine は10〜12の範囲で指定してください");
  }
  const characters = Array.from(value);
  const maximum = charactersPerLine * TEXT_MAX_LINES;
  const trimmed = characters.slice(0, maximum);
  const lines = Array.from({ length: TEXT_MAX_LINES }, (_, index) =>
    trimmed.slice(index * charactersPerLine, (index + 1) * charactersPerLine).join(""),
  ).filter(Boolean);
  return lines.join("\n");
}

/**
 * filter_complex文字列中で使用するパスをFFmpeg用にエスケープする。
 * シェル用エスケープではない（execFile()を使うためシェルエスケープは不要）。
 */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/gu, "\\\\").replace(/:/gu, "\\:").replace(/'/gu, "\\'");
}

function buildDrawtextFilter(options: DrawtextOptions): string {
  const {
    textFilePath,
    fontPath,
    y,
    fontSize = DEFAULT_FONT_SIZE,
    lineSpacing = DEFAULT_LINE_SPACING,
    enableUntil,
  } = options;
  const font = escapeFilterPath(fontPath);
  const text = escapeFilterPath(textFilePath);
  const enable = enableUntil === undefined ? "" : `:enable='lt(t\\,${enableUntil})'`;
  return [
    "drawtext=",
    `fontfile='${font}'`,
    `:textfile='${text}'`,
    `:fontsize=${fontSize}`,
    ":fontcolor=white",
    `:x='${DRAW_X_EXPRESSION}'`,
    `:y=${y}`,
    `:line_spacing=${lineSpacing}`,
    enable,
  ].join("");
}

function buildBlackInputArgs(duration: number): readonly string[] {
  return [
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${VIDEO_SIZE}x${VIDEO_SIZE}` + `:r=${VIDEO_FPS}:d=${duration}`,
  ];
}

function countWrappedLines(value: string): number {
  if (value.length === 0) return 0;
  return value.split("\n").length;
}

interface IntroTitleLayout {
  readonly y: number;
  readonly fontSize: number;
  readonly lineSpacing: number;
}

/** 冒頭タイトルカードのtitle配置。2行に折り返る場合はフォントを縮小して詰める。 */
function resolveIntroTitleLayout(wrappedTitle: string): IntroTitleLayout {
  const lineCount = countWrappedLines(wrappedTitle);
  if (lineCount >= 2) {
    return {
      y: INTRO_CENTER_Y - 28,
      fontSize: COMPACT_TITLE_FONT_SIZE,
      lineSpacing: COMPACT_LINE_SPACING,
    };
  }
  return {
    y: INTRO_CENTER_Y - DEFAULT_FONT_SIZE / 2,
    fontSize: DEFAULT_FONT_SIZE,
    lineSpacing: DEFAULT_LINE_SPACING,
  };
}

function buildIntroFilter(input: BuildFfmpegArgsInput): string {
  const wrappedTitle = wrapJapaneseText(sanitizeDrawtext(input.title));
  const layout = resolveIntroTitleLayout(wrappedTitle);
  const drawtext = buildDrawtextFilter({
    textFilePath: input.textFilePaths[TITLE_TEXT_INDEX],
    fontPath: input.fontPath,
    y: layout.y,
    fontSize: layout.fontSize,
    lineSpacing: layout.lineSpacing,
  });
  const fadeOutStart = TITLE_CARD_DURATION - TITLE_FADE_DURATION;
  return [
    `[${TITLE_INPUT_INDEX}:v]`,
    `format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1",
    `,${drawtext}`,
    `,fade=t=in:st=0:d=${TITLE_FADE_DURATION}`,
    `,fade=t=out:st=${fadeOutStart}:d=${TITLE_FADE_DURATION}`,
    "[intro]",
  ].join("");
}

function buildScene1Filter(input: BuildFfmpegArgsInput): string {
  const drawtext = buildDrawtextFilter({
    textFilePath: input.textFilePaths[FIRST_NARRATION_TEXT_INDEX],
    fontPath: input.fontPath,
    y: SUBTITLE_Y,
    lineSpacing: SUBTITLE_LINE_SPACING,
    enableUntil: SCENE_1_VISIBLE_DURATION,
  });
  return [
    "[0:v]",
    `trim=start=0:end=${SCENE_1_INPUT_DURATION}`,
    ",setpts=PTS-STARTPTS",
    `,format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1",
    `,fade=t=in:st=0:d=${SCENE_FADE_DURATION}`,
    `,fade=t=out:st=${SCENE_1_VISIBLE_DURATION}` + `:d=${SCENE_1_TRANSITION_DURATION}`,
    `,${drawtext}`,
    "[scene1]",
  ].join("");
}

function buildScene2Filter(input: BuildFfmpegArgsInput): string {
  const drawtext = buildDrawtextFilter({
    textFilePath: input.textFilePaths[FIRST_NARRATION_TEXT_INDEX + 1],
    fontPath: input.fontPath,
    y: SUBTITLE_Y,
    lineSpacing: SUBTITLE_LINE_SPACING,
  });
  const fadeOutStart = SCENE_2_DURATION - SCENE_FADE_DURATION;
  return [
    "[1:v]",
    `trim=start=0:end=${SCENE_2_DURATION}`,
    ",setpts=PTS-STARTPTS",
    `,format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1",
    `,fade=t=in:st=0:d=${SCENE_FADE_DURATION}`,
    `,fade=t=out:st=${fadeOutStart}` + `:d=${SCENE_FADE_DURATION}`,
    `,${drawtext}`,
    "[scene2]",
  ].join("");
}

function buildScene3Filter(input: BuildFfmpegArgsInput): string {
  const drawtext = buildDrawtextFilter({
    textFilePath: input.textFilePaths[FIRST_NARRATION_TEXT_INDEX + 2],
    fontPath: input.fontPath,
    y: SUBTITLE_Y,
    lineSpacing: SUBTITLE_LINE_SPACING,
    enableUntil: SCENE_3_DURATION,
  });
  const fadeOutStart = SCENE_3_DURATION - SCENE_FADE_DURATION;
  return [
    "[2:v]",
    `trim=start=0:end=${SCENE_3_DURATION}`,
    ",setpts=PTS-STARTPTS",
    `,format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1",
    `,fade=t=in:st=0:d=${SCENE_FADE_DURATION}`,
    `,fade=t=out:st=${fadeOutStart}` + `:d=${SCENE_FADE_DURATION}`,
    `,${drawtext}`,
    ",tpad=stop_mode=add" + `:stop_duration=${SCENE_3_BLACK_DURATION}` + ":color=black",
    "[scene3]",
  ].join("");
}

interface EndCardLayout {
  readonly titleY: number;
  readonly titleFontSize: number;
  readonly titleLineSpacing: number;
  readonly loglineY: number;
  readonly loglineFontSize: number;
  readonly loglineLineSpacing: number;
}

/**
 * 終盤カードのtitle/logline配置。行数の組み合わせ（1+1 / 2+1 / 1+2 / 2+2）ごとに
 * y440〜520へ収まる位置を選ぶ。もっとも厳しい2行+2行はtitleを24pxへ縮小する。
 */
function resolveEndCardLayout(titleLines: number, loglineLines: number): EndCardLayout {
  if (titleLines >= 2 && loglineLines >= 2) {
    return {
      titleY: END_CARD_TWO_TWO_TITLE_Y,
      titleFontSize: COMPACT_TITLE_FONT_SIZE,
      titleLineSpacing: COMPACT_LINE_SPACING,
      loglineY: END_CARD_TWO_TWO_LOGLINE_Y,
      loglineFontSize: DEFAULT_FONT_SIZE,
      loglineLineSpacing: COMPACT_LINE_SPACING,
    };
  }
  if (titleLines >= 2) {
    return {
      titleY: END_CARD_TWO_ONE_TITLE_Y,
      titleFontSize: COMPACT_TITLE_FONT_SIZE,
      titleLineSpacing: COMPACT_LINE_SPACING,
      loglineY: END_CARD_TWO_ONE_LOGLINE_Y,
      loglineFontSize: DEFAULT_FONT_SIZE,
      loglineLineSpacing: DEFAULT_LINE_SPACING,
    };
  }
  if (loglineLines >= 2) {
    return {
      titleY: END_CARD_ONE_TWO_TITLE_Y,
      titleFontSize: DEFAULT_FONT_SIZE,
      titleLineSpacing: DEFAULT_LINE_SPACING,
      loglineY: END_CARD_ONE_TWO_LOGLINE_Y,
      loglineFontSize: DEFAULT_FONT_SIZE,
      loglineLineSpacing: COMPACT_LINE_SPACING,
    };
  }
  return {
    titleY: END_CARD_ONE_ONE_TITLE_Y,
    titleFontSize: DEFAULT_FONT_SIZE,
    titleLineSpacing: DEFAULT_LINE_SPACING,
    loglineY: END_CARD_ONE_ONE_LOGLINE_Y,
    loglineFontSize: DEFAULT_FONT_SIZE,
    loglineLineSpacing: DEFAULT_LINE_SPACING,
  };
}

function buildEndCardFilter(input: BuildFfmpegArgsInput): string {
  const wrappedTitle = wrapJapaneseText(sanitizeDrawtext(input.title));
  const wrappedLogline = wrapJapaneseText(sanitizeDrawtext(input.logline));
  const layout = resolveEndCardLayout(
    countWrappedLines(wrappedTitle),
    countWrappedLines(wrappedLogline),
  );
  const title = buildDrawtextFilter({
    textFilePath: input.textFilePaths[TITLE_TEXT_INDEX],
    fontPath: input.fontPath,
    y: layout.titleY,
    fontSize: layout.titleFontSize,
    lineSpacing: layout.titleLineSpacing,
  });
  const logline = buildDrawtextFilter({
    textFilePath: input.textFilePaths[LOGLINE_TEXT_INDEX],
    fontPath: input.fontPath,
    y: layout.loglineY,
    fontSize: layout.loglineFontSize,
    lineSpacing: layout.loglineLineSpacing,
  });
  return [
    `[${END_CARD_INPUT_INDEX}:v]`,
    `format=${VIDEO_PIXEL_FORMAT}`,
    ",setsar=1",
    `,${title}`,
    `,${logline}`,
    "[endcard]",
  ].join("");
}

/** 冒頭カード・シーン1〜3・終盤カードを1本のfilter_complexへ組み立てる純粋関数。 */
export function buildFilterComplex(input: BuildFfmpegArgsInput): string {
  const filters = [
    buildIntroFilter(input),
    buildScene1Filter(input),
    buildScene2Filter(input),
    buildScene3Filter(input),
    buildEndCardFilter(input),
    "[intro][scene1][scene2][scene3][endcard]" +
      `concat=n=${CONCAT_SEGMENT_COUNT}:v=1:a=0[outv]`,
  ];
  return filters.join(";");
}

function validateBuildInput(input: BuildFfmpegArgsInput): void {
  if (input.scenePaths.length !== SCENE_COUNT) {
    throw new Error(`scenePaths は${SCENE_COUNT}本必要です`);
  }
  if (input.narrations.length !== SCENE_COUNT) {
    throw new Error(`narrations は${SCENE_COUNT}件必要です`);
  }
  if (input.textFilePaths.length !== TEXT_FILE_NAMES.length) {
    throw new Error(`textFilePaths は${TEXT_FILE_NAMES.length}件必要です`);
  }
}

/** ffmpegへそのまま渡せる引数配列を生成する純粋関数。 */
export function buildFfmpegArgs(input: BuildFfmpegArgsInput): readonly string[] {
  validateBuildInput(input);
  const sceneInputs = input.scenePaths.flatMap((path) => ["-i", path]);
  const blackInputs = [
    ...buildBlackInputArgs(TITLE_CARD_DURATION),
    ...buildBlackInputArgs(END_CARD_DURATION),
  ];
  return [
    // -y はFFmpegのglobal optionのため、入力群より前に置く。
    "-y",
    ...sceneInputs,
    ...blackInputs,
    "-filter_complex",
    buildFilterComplex(input),
    "-map",
    "[outv]",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    VIDEO_PIXEL_FORMAT,
    "-r",
    String(VIDEO_FPS),
    "-preset",
    "veryfast",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}

function prepareText(value: string): string {
  return wrapJapaneseText(sanitizeDrawtext(value, TEXT_MAX_CHARACTERS), TEXT_WRAP_CHARACTERS);
}

async function writeSceneFiles(
  directory: string,
  sceneVideos: readonly Uint8Array[],
): Promise<readonly string[]> {
  const paths = SCENE_FILE_NAMES.map((name) => join(directory, name));
  await Promise.all(paths.map((path, index) => writeFile(path, sceneVideos[index])));
  return paths;
}

async function writeTextFiles(
  directory: string,
  movie: MovieDescription,
): Promise<readonly string[]> {
  const paths = TEXT_FILE_NAMES.map((name) => join(directory, name));
  const contents = [
    prepareText(movie.title),
    prepareText(movie.logline),
    ...movie.scenes.map((scene) => prepareText(scene.narration)),
  ];
  await Promise.all(paths.map((path, index) => writeFile(path, contents[index], "utf8")));
  return paths;
}

function validateMovie(sceneVideos: readonly Uint8Array[], movie: MovieDescription): void {
  if (sceneVideos.length !== SCENE_COUNT) {
    throw new Error(`sceneVideos は${SCENE_COUNT}本必要です`);
  }
  if (movie.scenes.length !== SCENE_COUNT) {
    throw new Error(`movie.scenes は${SCENE_COUNT}件必要です`);
  }
}

async function executeFfmpeg(
  ffmpegPath: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<void> {
  await execFileAsync(ffmpegPath, [...args], {
    timeout: timeoutMs,
    maxBuffer: FFMPEG_MAX_BUFFER,
    windowsHide: true,
    killSignal: "SIGKILL",
  });
}

/**
 * 3シーンから18.2秒の予告編動画を生成する。
 * ffmpegは1回だけ起動し、単一filter_complex内でtrim・fade・drawtext・concatを完結させる。
 */
export async function composeMovie(
  sceneVideos: Uint8Array[],
  movie: MovieDescription,
  timeoutMs: number,
): Promise<Uint8Array> {
  validateMovie(sceneVideos, movie);
  const directory = await mkdtemp(join(tmpdir(), "compose-movie-"));
  try {
    const [ffmpegPath, fontPath] = await Promise.all([resolveFfmpegPath(), resolveFontPath()]);
    const scenePaths = await writeSceneFiles(directory, sceneVideos);
    const textFilePaths = await writeTextFiles(directory, movie);
    const outputPath = join(directory, OUTPUT_FILE_NAME);
    const args = buildFfmpegArgs({
      scenePaths,
      fontPath,
      textFilePaths,
      title: movie.title,
      logline: movie.logline,
      narrations: movie.scenes.map((scene) => scene.narration),
      outputPath,
    });
    await executeFfmpeg(ffmpegPath, args, timeoutMs);
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
