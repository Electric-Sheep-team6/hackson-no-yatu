export type GenerateSceneInput = {
  prompt: string;
  duration: number;
  referenceImageUrls: string[];
};

export type GenerateSceneResult = {
  providerJobId: string;
  videoData?: Uint8Array;
};

export interface VideoGenerator {
  generateScene(input: GenerateSceneInput): Promise<GenerateSceneResult>;
}
