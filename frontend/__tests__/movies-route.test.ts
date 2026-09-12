import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  processMovieGeneration,
  SCENE_CONCURRENCY,
} from "@/app/api/movies/generation";

const MOVIE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "user-1";

function createScript(orders = [1, 2, 3, 4]) {
  return {
    title: "title",
    logline: "logline",
    synopsis: "synopsis",
    visualStyle: "style",
    bgm: "bgm",
    scenes: orders.map((order) => ({
      order,
      source: `source-${order}`,
      duration: 5,
      narration: `narration-${order}`,
      videoPrompt: `scene-${order}`,
      referencePhotoUrls: [],
    })),
  };
}

function createGenerationAdmin() {
  const updates: Record<string, unknown>[] = [];
  const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
  const update = vi.fn((values: Record<string, unknown>) => {
    updates.push(values);
    return {
      eq: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    };
  });
  const admin = {
    from: vi.fn((table: string) => table === "photos"
      ? {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        }
      : { update }),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(),
        upload,
      })),
    },
  };
  return { admin, updates, upload };
}

async function runGeneration() {
  await processMovieGeneration(MOVIE_ID, USER_ID, {} as never);
}

describe("POST /api/movies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  it("24時間の上限到達時は映画ジョブを作らず429を返す", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
    });

    const insert = vi.fn();
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
          : {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gte: vi.fn().mockResolvedValue({ count: 3, error: null }),
                })),
              })),
              insert,
            },
      ),
      rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
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

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: "rate_limited",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("全プランで利用できる実行時間上限を指定する", async () => {
    const route = await import("@/app/api/movies/route");

    expect(route.maxDuration).toBe(300);
  });

  it("完了順に関係なくscene.order昇順で連結する", async () => {
    const { admin } = createGenerationAdmin();
    const resolvers = new Map<number, (value: {
      providerJobId: string;
      videoData: Uint8Array;
    }) => void>();
    createAdminClientMock.mockReturnValue(admin);
    generateMovieScriptMock.mockResolvedValue(createScript([3, 1, 2, 4]));
    generateSceneMock.mockImplementation(({ prompt }: { prompt: string }) => {
      const order = Number(prompt.split("-")[1]);
      return new Promise((resolve) => resolvers.set(order, resolve));
    });
    composeMovieMock.mockResolvedValue(new Uint8Array([9]));

    const generation = runGeneration();
    await vi.waitFor(() => expect(resolvers.size).toBe(SCENE_CONCURRENCY));
    [3, 2, 1].forEach((order) => resolvers.get(order)?.({
      providerJobId: `job-${order}`,
      videoData: new Uint8Array([order]),
    }));
    await generation;

    expect(generateSceneMock).toHaveBeenCalledTimes(3);
    expect(composeMovieMock).toHaveBeenCalledWith(
      [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
      expect.objectContaining({ title: "title", logline: "logline" }),
      expect.any(Number),
    );
  });

  it("シーン生成の同時実行数が上限を超えない", async () => {
    const { admin } = createGenerationAdmin();
    const pending: (() => void)[] = [];
    let activeCount = 0;
    let maxActiveCount = 0;
    createAdminClientMock.mockReturnValue(admin);
    generateMovieScriptMock.mockResolvedValue(createScript());
    generateSceneMock.mockImplementation(() => new Promise((resolve) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      pending.push(() => {
        activeCount -= 1;
        resolve({ providerJobId: "job", videoData: new Uint8Array([1]) });
      });
    }));
    composeMovieMock.mockResolvedValue(new Uint8Array([9]));

    const generation = runGeneration();
    await vi.waitFor(() => expect(pending).toHaveLength(SCENE_CONCURRENCY));
    pending.forEach((resolve) => resolve());
    await generation;

    expect(maxActiveCount).toBe(SCENE_CONCURRENCY);
    expect(generateSceneMock).toHaveBeenCalledTimes(3);
  });

  it("一過性エラーでも自動再試行せず失敗する", async () => {
    const { admin, updates } = createGenerationAdmin();
    createAdminClientMock.mockReturnValue(admin);
    generateMovieScriptMock.mockResolvedValue(createScript());
    generateSceneMock.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt === "scene-1") throw { status: 429 };
      const order = Number(prompt.split("-")[1]);
      return { providerJobId: `job-${order}`, videoData: new Uint8Array([order]) };
    });
    composeMovieMock.mockResolvedValue(new Uint8Array([9]));

    await runGeneration();

    expect(generateSceneMock).toHaveBeenCalledTimes(3);
    expect(composeMovieMock).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      error_message: "シーン1の生成に失敗しました（レート制限）",
    });
    const sceneUpdate = updates.find((value) =>
      typeof value.movie_json === "object" && !("status" in value),
    );
    expect(sceneUpdate).toMatchObject({
      movie_json: {
        generatedScenes: expect.arrayContaining([
          expect.objectContaining({ order: 1, retryCount: 0, status: "failed" }),
        ]),
      },
    });
  });

  it("Input blockedでも自動再試行せず失敗する", async () => {
    const { admin, updates } = createGenerationAdmin();
    createAdminClientMock.mockReturnValue(admin);
    generateMovieScriptMock.mockResolvedValue(createScript([1]));
    generateSceneMock.mockRejectedValue({
      status: 400,
      message: "Input blocked: prompt could not be processed",
    });

    await runGeneration();

    expect(generateSceneMock).toHaveBeenCalledTimes(1);
    expect(composeMovieMock).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      error_message: "シーン1の生成に失敗しました（入力ブロック）",
    });
  });

  it("生成失敗時に失敗段階と安全な分類を保存する", async () => {
    const { admin, updates } = createGenerationAdmin();
    createAdminClientMock.mockReturnValue(admin);
    generateMovieScriptMock.mockResolvedValue(createScript());
    generateSceneMock.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt === "scene-2") throw { name: "AbortError" };
      const order = Number(prompt.split("-")[1]);
      return { providerJobId: `job-${order}`, videoData: new Uint8Array([order]) };
    });
    composeMovieMock.mockResolvedValue(new Uint8Array([9]));

    await runGeneration();

    expect(generateSceneMock).toHaveBeenCalledTimes(3);
    expect(composeMovieMock).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      error_message: "シーン2の生成に失敗しました（タイムアウト）",
    });
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        movie_json: expect.objectContaining({
          generatedScenes: expect.arrayContaining([
            expect.objectContaining({
              order: 2,
              providerJobId: null,
              retryCount: 0,
              status: "failed",
            }),
          ]),
        }),
      }),
    ]));
  });
});
