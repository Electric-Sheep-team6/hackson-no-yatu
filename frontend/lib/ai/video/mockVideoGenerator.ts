import type {
  GenerateSceneInput,
  GenerateSceneResult,
  VideoGenerator,
} from "./VideoGenerator";

export class MockVideoGenerator implements VideoGenerator {
  async generateScene(
    input: GenerateSceneInput,
  ): Promise<GenerateSceneResult> {
    // TODO(佐藤佑作): Gemini動画生成adapterへ差し替える。
    void input;
    return {
      providerJobId: "mock-video-job",
      videoData: new Uint8Array([0]),
    };
  }
}

export const mockVideoGenerator = new MockVideoGenerator();
