import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  afterMock,
  composeMovieMock,
  createAdminClientMock,
  createClientMock,
  generateMovieScriptMock,
  generateSceneMock,
} = vi.hoisted(
  () => ({
    afterMock: vi.fn(),
    composeMovieMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    createClientMock: vi.fn(),
    generateMovieScriptMock: vi.fn(),
    generateSceneMock: vi.fn(),
  }),
);

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));
vi.mock("@/lib/ai/generateMovieScript", () => ({
  generateMovieScript: generateMovieScriptMock,
}));
vi.mock("@/lib/ai/video/composeMovie", () => ({
  composeMovie: composeMovieMock,
}));
vi.mock("@/lib/ai/video/geminiVideoGenerator", () => ({
  geminiVideoGenerator: { generateScene: generateSceneMock },
}));

import { POST } from "@/app/api/movies/route";

describe("POST /api/movies", () => {
  beforeEach(() => vi.clearAllMocks());

  it("実行中映画の一意制約違反を409へ変換する", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
    });

    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }),
      })),
    }));
    const moviesSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
      })),
    }));
    const recoverStale = vi.fn().mockResolvedValue({ data: 1, error: null });
    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "obsessions"
          ? {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "11111111-1111-4111-8111-111111111111",
                      user_id: "user-1",
                      analysis_json: {},
                    },
                    error: null,
                  }),
                })),
              })),
            }
          : { select: moviesSelect, insert },
      ),
      rpc: recoverStale,
    });

    const response = await POST(
      new Request("http://localhost/api/movies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          obsessionId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "conflict",
    });
    expect(afterMock).not.toHaveBeenCalled();
    expect(recoverStale).toHaveBeenCalledWith(
      "recover_stale_movie_generations",
      { p_user_id: "user-1" },
    );
  });

  it("全プランで利用できる実行時間上限を指定する", async () => {
    const route = await import("@/app/api/movies/route");

    expect(route.maxDuration).toBe(300);
  });

  it("AIをモックして脚本作成、全シーン生成、結合、完成保存まで実行する", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
    });

    const movieId = "22222222-2222-4222-8222-222222222222";
    const obsessionId = "11111111-1111-4111-8111-111111111111";
    const statuses: unknown[] = [];
    const update = vi.fn((values: Record<string, unknown>) => {
      if (values.status) statuses.push(values.status);
      return {
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
    });
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: movieId, status: "pending" },
          error: null,
        }),
      })),
    }));
    const createSignedUrl = vi
      .fn()
      .mockImplementation(async (path: string) =>
        path.endsWith("missing.jpg")
          ? { data: null, error: new Error("object not found") }
          : {
              data: { signedUrl: `https://storage.example.com/${path}` },
              error: null,
            },
      );
    const upload = vi.fn().mockResolvedValue({ error: null });
    const photoLimit = vi.fn().mockResolvedValue({
      data: [
        { storage_path: "user-1/photo-1.jpg" },
        { storage_path: "user-1/missing.jpg" },
        { storage_path: "user-1/photo-2.jpg" },
      ],
      error: null,
    });
    const photoOrder = vi.fn(() => ({ limit: photoLimit }));
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      from: vi.fn((table: string) => {
        if (table === "obsessions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: obsessionId,
                    user_id: "user-1",
                    analysis_json: { title: "夜道への偏愛" },
                  },
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === "photos") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: photoOrder,
              })),
            })),
          };
        }
        return { insert, update };
      }),
      storage: {
        from: vi.fn((bucket: string) =>
          bucket === "photos" ? { createSignedUrl } : { upload },
        ),
      },
    };
    createAdminClientMock.mockReturnValue(admin);

    const photoUrls = [
      "https://storage.example.com/user-1/photo-1.jpg",
      "https://storage.example.com/user-1/photo-2.jpg",
    ];
    const movieScript = {
      title: "夜道の映画",
      logline: "雨上がりの夜道を歩く。",
      synopsis: "夜道の記憶をたどる短編。",
      visualStyle: "cinematic",
      bgm: "ambient",
      scenes: [1, 2, 3].map((order) => ({
        order,
        source: `scene-${order}`,
        duration: 5,
        narration: `narration-${order}`,
        videoPrompt: `prompt-${order}`,
        referencePhotoUrls: order === 1 ? [photoUrls[0]] : [],
      })),
    };
    generateMovieScriptMock.mockResolvedValue(movieScript);
    generateSceneMock
      .mockResolvedValueOnce({
        providerJobId: "job-1",
        videoData: new Uint8Array([1]),
      })
      .mockResolvedValueOnce({
        providerJobId: "job-2",
        videoData: new Uint8Array([2]),
      })
      .mockResolvedValueOnce({
        providerJobId: "job-3",
        videoData: new Uint8Array([3]),
      });
    composeMovieMock.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const response = await POST(
      new Request("http://localhost/api/movies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obsessionId }),
      }),
    );

    expect(response.status).toBe(201);
    expect(afterMock).toHaveBeenCalledOnce();
    const backgroundJob = afterMock.mock.calls[0][0] as () => Promise<void>;
    await backgroundJob();

    expect(generateMovieScriptMock).toHaveBeenCalledWith({
      obsession: { title: "夜道への偏愛" },
      photoUrls,
    });
    expect(photoOrder).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(photoLimit).toHaveBeenCalledWith(12);
    expect(generateSceneMock).toHaveBeenCalledTimes(3);
    expect(generateSceneMock).toHaveBeenNthCalledWith(1, {
      prompt: "prompt-1",
      duration: 5,
      referenceImageUrls: [photoUrls[0]],
    });
    expect(composeMovieMock).toHaveBeenCalledWith([
      new Uint8Array([1]),
      new Uint8Array([2]),
      new Uint8Array([3]),
    ]);
    expect(upload).toHaveBeenCalledTimes(4);
    expect(
      update.mock.calls.filter(
        ([values]) => values.status === undefined && values.updated_at,
      ),
    ).toHaveLength(3);
    expect(upload).toHaveBeenLastCalledWith(
      "user-1/22222222-2222-4222-8222-222222222222.mp4",
      new Uint8Array([1, 2, 3]),
      { contentType: "video/mp4", upsert: true },
    );
    expect(statuses).toEqual([
      "analyzing",
      "generating",
      "processing",
      "completed",
    ]);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "completed",
        video_path:
          "user-1/22222222-2222-4222-8222-222222222222.mp4",
        error_message: null,
      }),
    );
  });

  it("途中失敗時に保存済みシーン動画を削除して孤立させない", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
    });

    const movieId = "22222222-2222-4222-8222-222222222222";
    const obsessionId = "11111111-1111-4111-8111-111111111111";
    const statuses: unknown[] = [];
    const update = vi.fn((values: Record<string, unknown>) => {
      if (values.status) statuses.push(values.status);
      return {
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
    });
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: movieId, status: "pending" },
          error: null,
        }),
      })),
    }));
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      from: vi.fn((table: string) => {
        if (table === "obsessions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: obsessionId,
                    user_id: "user-1",
                    analysis_json: { title: "夜道への偏愛" },
                  },
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === "photos") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
              })),
            })),
          };
        }
        return { insert, update };
      }),
      storage: {
        from: vi.fn((bucket: string) =>
          bucket === "photos"
            ? { createSignedUrl: vi.fn() }
            : { upload, remove },
        ),
      },
    };
    createAdminClientMock.mockReturnValue(admin);

    generateMovieScriptMock.mockResolvedValue({
      title: "夜道の映画",
      logline: "雨上がりの夜道を歩く。",
      synopsis: "夜道の記憶をたどる短編。",
      visualStyle: "cinematic",
      bgm: "ambient",
      scenes: [1, 2, 3].map((order) => ({
        order,
        source: `scene-${order}`,
        duration: 5,
        narration: `narration-${order}`,
        videoPrompt: `prompt-${order}`,
        referencePhotoUrls: [],
      })),
    });
    generateSceneMock
      .mockResolvedValueOnce({
        providerJobId: "job-1",
        videoData: new Uint8Array([1]),
      })
      .mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await POST(
      new Request("http://localhost/api/movies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obsessionId }),
      }),
    );
    const backgroundJob = afterMock.mock.calls[0][0] as () => Promise<void>;
    await backgroundJob();

    expect(response.status).toBe(201);
    expect(statuses).toEqual([
      "analyzing",
      "generating",
      "processing",
      "failed",
    ]);
    expect(remove).toHaveBeenCalledWith([
      "user-1/22222222-2222-4222-8222-222222222222/scenes/1.mp4",
    ]);
    expect(composeMovieMock).not.toHaveBeenCalled();
  });
});
