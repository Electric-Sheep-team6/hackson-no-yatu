import type { ObsessionAnalysis } from "./analyzeObsession";

export type GenerateMovieScriptInput = {
  obsession: ObsessionAnalysis;
  photoUrls: string[];
};

export type MovieScript = {
  title: string;
  logline: string;
  synopsis: string;
  visualStyle: string;
  bgm: string;
  scenes: {
    order: number;
    source: string;
    duration: number;
    narration: string;
    videoPrompt: string;
    referencePhotoUrls: string[];
  }[];
};

export async function generateMovieScript(
  input: GenerateMovieScriptInput,
): Promise<MovieScript> {
  // TODO(佐藤佑作): OpenAI Responses APIへ差し替える。
  void input;
  return {
    title: "モック映画",
    logline: "偏愛から生まれる短い物語です",
    synopsis: "AI未接続のため仮のあらすじです",
    visualStyle: "cinematic, soft light",
    bgm: "gentle ambient music",
    scenes: [
      {
        order: 1,
        source: "モックシーン",
        duration: 5,
        narration: "これはモック動画です。",
        videoPrompt:
          "A single continuous cinematic shot, soft light, no scene transitions.",
        referencePhotoUrls: [],
      },
      {
        order: 2,
        source: "モックシーン",
        duration: 5,
        narration: "仮の物語が続きます。",
        videoPrompt:
          "A single continuous cinematic shot, gentle camera movement, no scene transitions.",
        referencePhotoUrls: [],
      },
      {
        order: 3,
        source: "モックシーン",
        duration: 5,
        narration: "これはモック動画の結末です。",
        videoPrompt:
          "A single continuous cinematic closing shot, warm light, no scene transitions.",
        referencePhotoUrls: [],
      },
    ],
  };
}
