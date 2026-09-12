import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  composeHybridMovie: vi.fn(),
  composeMemoryMontage: vi.fn(),
  createAdminClient: vi.fn(),
  generateHybridMoviePlan: vi.fn(),
  generateMotifImage: vi.fn(),
  generateScene: vi.fn(),
  loadReferenceImage: vi.fn(),
}));

vi.mock("@/lib/ai/generateHybridMoviePlan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/generateHybridMoviePlan")>()),
  generateHybridMoviePlan: mocks.generateHybridMoviePlan,
}));
vi.mock("@/lib/ai/referenceImage", () => ({
  beginMovieImageCache: vi.fn(),
  loadReferenceImage: mocks.loadReferenceImage,
}));
vi.mock("@/lib/ai/image/geminiImageGenerator", () => ({
  generateGeminiMotifImage: mocks.generateMotifImage,
}));
vi.mock("@/lib/ai/video/composeHybridMovie", () => ({
  composeHybridMovie: mocks.composeHybridMovie,
  composeMemoryMontage: mocks.composeMemoryMontage,
}));
vi.mock("@/lib/ai/video/geminiVideoGenerator", () => ({
  geminiVideoGenerator: { generateScene: mocks.generateScene },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { processMovieGeneration, SCENE_CONCURRENCY } from "@/app/api/movies/generation";

const MOVIE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "user-1";
const plan = {
  title: "記憶の輪郭",
  logline: "一人の時間が、映画になる。",
  synopsis: "記録をたどる予告編",
  photoOrder: [1],
  heroPrompt: "Three cinematic symbolic shots, no text.",
  motifs: [
    { name: "軽トラック", count: 3, evidencePhotoNumbers: [1], objectDescription: "white truck", imagePrompt: "truck" },
    { name: "花火", count: 2, evidencePhotoNumbers: [1], objectDescription: "sparkler", imagePrompt: "sparkler" },
  ],
  chapterLines: ["始まりは記録だった", "運命が動き出す", "記憶は消えない"],
};

function createAdmin() {
  const updates: Record<string, unknown>[] = [];
  const upload = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn((value: Record<string, unknown>) => {
    updates.push(value);
    return { eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) };
  });
  const rows = (data: { storage_path: string }[]) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data, error: null }) })),
      })),
    })),
  });
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "photos") return rows([{ storage_path: "user-1/photo.jpg" }]);
      if (table === "videos") return rows([]);
      return { update };
    }),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn((path: string) => Promise.resolve({ data: { signedUrl: `https://storage.example/${path}` }, error: null })),
        upload,
      })),
    },
  };
  return { admin, updates, upload };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generateMotifImage.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.generateHybridMoviePlan.mockResolvedValue(plan);
  mocks.loadReferenceImage.mockResolvedValue({ data: "AQID", mimeType: "image/jpeg" });
  mocks.composeMemoryMontage.mockResolvedValue(new Uint8Array([4]));
  mocks.generateMotifImage
    .mockResolvedValueOnce({ providerJobId: "image-1", data: new Uint8Array([6]), mimeType: "image/jpeg" })
    .mockResolvedValueOnce({ providerJobId: "image-2", data: new Uint8Array([7]), mimeType: "image/jpeg" });
  mocks.generateScene.mockResolvedValue({ providerJobId: "job-1", videoData: new Uint8Array([5]) });
  mocks.composeHybridMovie.mockResolvedValue(new Uint8Array([9]));
});

describe("hybrid movie generation", () => {
  it("Gemini動画生成を1回だけ呼び、上限10秒の非人物象徴カットを要求する", async () => {
    const { admin, updates } = createAdmin();
    mocks.createAdminClient.mockReturnValue(admin);

    await processMovieGeneration(MOVIE_ID, USER_ID, {} as never);

    expect(SCENE_CONCURRENCY).toBe(1);
    expect(mocks.generateScene).toHaveBeenCalledTimes(1);
    expect(mocks.generateScene).toHaveBeenCalledWith(expect.objectContaining({
      duration: 10,
      referenceImageUrls: ["data:image/jpeg;base64,Bg==", "data:image/jpeg;base64,Bw=="],
    }));
    expect(mocks.composeMemoryMontage).toHaveBeenCalledTimes(1);
    expect(mocks.composeHybridMovie).toHaveBeenCalledWith(
      new Uint8Array([4]),
      new Uint8Array([5]),
      plan,
      expect.any(Number),
    );
    expect(updates.at(-1)).toMatchObject({
      status: "completed",
      movie_json: {
        mix: { actualPercent: 75, aiPercent: 25, durationSeconds: 60.5 },
        generatedScenes: [{ retryCount: 0, status: "succeeded" }],
        generatedMotifs: [
          expect.objectContaining({ name: "軽トラック", providerJobId: "image-1" }),
          expect.objectContaining({ name: "花火", providerJobId: "image-2" }),
        ],
      },
    });
  });

  it("AI生成失敗時も自動再試行しない", async () => {
    const { admin, updates } = createAdmin();
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.generateScene.mockRejectedValue(Object.assign(new Error("rate limit"), { status: 429 }));

    await processMovieGeneration(MOVIE_ID, USER_ID, {} as never);

    expect(mocks.generateScene).toHaveBeenCalledTimes(1);
    expect(mocks.composeHybridMovie).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      error_message: "動画生成に失敗しました（レート制限）",
    });
  });

  it("Vercel関数の実行上限を300秒に保つ", async () => {
    const route = await import("@/app/api/movies/route");
    expect(route.maxDuration).toBe(300);
  });
});

