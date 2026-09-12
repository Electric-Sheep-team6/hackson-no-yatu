const PLAY_RESOLUTION = 720;
const FONT_NAME = "Noto Sans JP";
const SAFE_MARGIN_HORIZONTAL = 200;
const ASS_FADE_MS = 300;

const TITLE_MAX_CHARACTERS = 15;
const LOGLINE_MAX_CHARACTERS = 40;
const NARRATION_MAX_CHARACTERS = 30;
const TITLE_CHARACTERS_PER_LINE = 10;
const LOGLINE_CHARACTERS_PER_LINE = 20;
const NARRATION_CHARACTERS_PER_LINE = 10;

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: ${PLAY_RESOLUTION}
PlayResY: ${PLAY_RESOLUTION}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Intro,${FONT_NAME},32,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,${SAFE_MARGIN_HORIZONTAL},${SAFE_MARGIN_HORIZONTAL},448,1
Style: Subtitle,${FONT_NAME},32,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,8,${SAFE_MARGIN_HORIZONTAL},${SAFE_MARGIN_HORIZONTAL},448,1
Style: EndTitle,${FONT_NAME},20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,${SAFE_MARGIN_HORIZONTAL},${SAFE_MARGIN_HORIZONTAL},440,1
Style: EndLogline,${FONT_NAME},18,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,${SAFE_MARGIN_HORIZONTAL},${SAFE_MARGIN_HORIZONTAL},482,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

export interface AssMovieDescription {
  readonly title: string;
  readonly logline: string;
  readonly scenes: readonly { readonly narration: string }[];
}

interface AssEvent {
  readonly start: string;
  readonly end: string;
  readonly style: "Intro" | "Subtitle" | "EndTitle" | "EndLogline";
  readonly text: string;
}

/** ASSの制御文字として解釈される記号を表示用の全角文字へ変換する。 */
export function sanitizeAssText(value: string, maxCharacters: number): string {
  const withoutLineBreaks = value.replace(/\r\n|[\n\u2028\u2029]/gu, " ");
  const withoutControls = withoutLineBreaks.replace(/\p{Cc}/gu, "");
  const normalized = withoutControls.replace(/\s+/gu, " ").trim();
  const escaped = normalized
    .replace(/\\/gu, "＼")
    .replace(/\{/gu, "｛")
    .replace(/\}/gu, "｝");
  return Array.from(escaped).slice(0, maxCharacters).join("");
}

/** libassが日本語を自動折り返ししない環境でも、指定行数を中央揃えにする。 */
export function wrapAssText(
  value: string,
  charactersPerLine: number,
  maxLines = 2,
): string {
  const characters = Array.from(value);
  return Array.from({ length: maxLines }, (_, index) =>
    characters
      .slice(index * charactersPerLine, (index + 1) * charactersPerLine)
      .join(""),
  ).filter(Boolean).join("\\N");
}

function prepareAssText(
  value: string,
  maxCharacters: number,
  charactersPerLine: number,
  maxLines = 2,
): string {
  return wrapAssText(
    sanitizeAssText(value, maxCharacters),
    charactersPerLine,
    maxLines,
  );
}

function dialogue(event: AssEvent): string {
  const fade = `{\\fad(${ASS_FADE_MS},${ASS_FADE_MS})}`;
  return `Dialogue: 0,${event.start},${event.end},${event.style},,0,0,0,,${fade}${event.text}`;
}

function buildEvents(movie: AssMovieDescription): readonly AssEvent[] {
  return [
    {
      start: "0:00:00.00",
      end: "0:00:02.50",
      style: "Intro",
      text: prepareAssText(movie.title, TITLE_MAX_CHARACTERS, TITLE_CHARACTERS_PER_LINE),
    },
    ...movie.scenes.slice(0, 3).map((scene, index) => ({
      start: ["0:00:02.50", "0:00:07.40", "0:00:11.40"][index],
      end: ["0:00:07.00", "0:00:11.40", "0:00:14.40"][index],
      style: "Subtitle" as const,
      text: prepareAssText(
        scene.narration,
        NARRATION_MAX_CHARACTERS,
        NARRATION_CHARACTERS_PER_LINE,
        3,
      ),
    })),
    {
      start: "0:00:14.90",
      end: "0:00:18.20",
      style: "EndTitle",
      text: prepareAssText(movie.title, TITLE_MAX_CHARACTERS, TITLE_CHARACTERS_PER_LINE),
    },
    {
      start: "0:00:14.90",
      end: "0:00:18.20",
      style: "EndLogline",
      text: prepareAssText(
        movie.logline,
        LOGLINE_MAX_CHARACTERS,
        LOGLINE_CHARACTERS_PER_LINE,
      ),
    },
  ];
}

export function buildAssSubtitles(movie: AssMovieDescription): string {
  return `${ASS_HEADER}\n${buildEvents(movie).map(dialogue).join("\n")}\n`;
}
