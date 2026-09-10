export type GenerateSceneInput = {
  prompt: string;
  duration: number;
  referenceImageUrls: string[];
};

export type GenerateSceneResult = {
  providerJobId: string;
  videoUrl?: string;
};

export interface VideoGenerator {
  generateScene(input: GenerateSceneInput): Promise<GenerateSceneResult>;
}
