export type AnalyzeObsessionInput = {
  diaryTexts: string[];
  photoUrls: string[];
};

export type ObsessionAnalysis = {
  title: string;
  reason: string;
  keywords: string[];
  emotion: string[];
  evidence: {
    sourceType: "diary" | "photo";
    summary: string;
  }[];
  visualMotifs: string[];
};

export async function analyzeObsession(
  input: AnalyzeObsessionInput,
): Promise<ObsessionAnalysis> {
  // TODO(佐藤佑作): OpenAI Responses APIへ差し替える。
  void input;
  return {
    title: "モック偏愛",
    reason: "AI未接続のため仮の値です",
    keywords: [],
    emotion: [],
    evidence: [],
    visualMotifs: [],
  };
}
