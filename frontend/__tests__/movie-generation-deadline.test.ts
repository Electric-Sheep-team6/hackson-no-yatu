import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const {
  composeMovieMock,
  createAdminClientMock,
  generateMovieScriptMock,
  generateSceneMock,
} = vi.hoisted(() => ({
  composeMovieMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  generateMovieScriptMock: vi.fn(),
  generateSceneMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/ai/generateMovieScript", () => ({
  generateMovieScript: generateMovieScriptMock,
}));

vi.mock("@/lib/ai/video/composeMovie", () => ({
  composeMovie: composeMovieMock,
}));

vi.mock(
  "@/lib/ai/video/geminiVideoGenerator",
  () => ({
    geminiVideoGenerator: {
      generateScene: generateSceneMock,
    },
  }),
);

import {
  MAX_SCENE_RETRIES,
  processMovieGeneration,
} from "@/app/api/movies/generation";
import {
  GENERATION_DEADLINE_MS,
  SCENE_RETRY_REQUIRED_MS,
} from "@/lib/ai/timeouts";

const MOVIE_ID =
  "22222222-2222-4222-8222-222222222222";
const USER_ID = "user-1";
const INITIAL_TIME =
  new Date("2026-09-12T00:00:00.000Z");
const VIDEO_BYTE = 1;
const FINAL_VIDEO_BYTE = 9;
const DEADLINE_EXCESS_MS = 1;

function createScript(
  orders: number[] = [1],
) {
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
  let updates: Record<string, unknown>[] = [];

  const upload = vi
    .fn()
    .mockResolvedValue({
      data: {},
      error: null,
    });

  const update = vi.fn(
    (values: Record<string, unknown>) => {
      updates = [...updates, values];

      return {
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        })),
      };
    },
  );

  const admin = {
    from: vi.fn(
      (table: string) =>
        table === "photos"
          ? {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi
                    .fn()
                    .mockResolvedValue({
                      data: [],
                      error: null,
                    }),
                })),
              })),
            }
          : { update },
    ),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(),
        upload,
      })),
    },
  };

  return {
    admin,
    getUpdates: () => updates,
    upload,
  };
}

function succeededScene() {
  return {
    providerJobId: "job-1",
    videoData: new Uint8Array([
      VIDEO_BYTE,
    ]),
  };
}

async function runGeneration() {
  await processMovieGeneration(
    MOVIE_ID,
    USER_ID,
    {} as never,
  );
}

function lastUpdate(
  getUpdates: () => Record<string, unknown>[],
) {
  return getUpdates().at(-1);
}

describe(
  "映画生成のエラー分類とデッドライン管理",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers();
      vi.setSystemTime(INITIAL_TIME);

      vi.spyOn(
        console,
        "log",
      ).mockImplementation(() => undefined);

      vi.spyOn(
        console,
        "error",
      ).mockImplementation(() => undefined);

      composeMovieMock.mockResolvedValue(
        new Uint8Array([FINAL_VIDEO_BYTE]),
      );
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it(
      "400 Input blocked は一度だけ再試行して成功する",
      async () => {
        const {
          admin,
          getUpdates,
        } = createGenerationAdmin();

        createAdminClientMock.mockReturnValue(
          admin,
        );

        generateMovieScriptMock.mockResolvedValue(
          createScript(),
        );

        generateSceneMock
          .mockRejectedValueOnce({
            status: 400,
            message:
              "Input blocked: xxx",
          })
          .mockResolvedValueOnce(
            succeededScene(),
          );

        const generation = runGeneration();

        await vi.runAllTimersAsync();
        await generation;

        expect(
          generateSceneMock,
        ).toHaveBeenCalledTimes(
          1 + MAX_SCENE_RETRIES,
        );

        expect(
          lastUpdate(getUpdates),
        ).toMatchObject({
          status: "completed",
        });

        expect(
          composeMovieMock,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "Input blocked ではない400は再試行せず失敗する",
      async () => {
        const {
          admin,
          getUpdates,
        } = createGenerationAdmin();

        createAdminClientMock.mockReturnValue(
          admin,
        );

        generateMovieScriptMock.mockResolvedValue(
          createScript(),
        );

        generateSceneMock.mockRejectedValue({
          status: 400,
          message:
            "Bad request: missing field",
        });

        await runGeneration();

        expect(
          generateSceneMock,
        ).toHaveBeenCalledTimes(1);

        expect(
          composeMovieMock,
        ).not.toHaveBeenCalled();

        expect(
          lastUpdate(getUpdates),
        ).toMatchObject({
          status: "failed",
          error_message:
            "シーン1の生成に失敗しました（その他）",
        });
      },
    );

    it(
      "残り時間が再試行必要時間未満なら一過性エラーでも再試行しない",
      async () => {
        const {
          admin,
          getUpdates,
        } = createGenerationAdmin();

        createAdminClientMock.mockReturnValue(
          admin,
        );

        generateMovieScriptMock.mockResolvedValue(
          createScript(),
        );

        const elapsedMs =
          GENERATION_DEADLINE_MS
          - SCENE_RETRY_REQUIRED_MS
          + DEADLINE_EXCESS_MS;

        generateSceneMock.mockImplementation(
          async () => {
            vi.setSystemTime(
              new Date(
                INITIAL_TIME.getTime()
                + elapsedMs,
              ),
            );

            throw {
              status: 429,
              message:
                "Too many requests",
            };
          },
        );

        await runGeneration();

        expect(
          generateSceneMock,
        ).toHaveBeenCalledTimes(1);

        expect(
          composeMovieMock,
        ).not.toHaveBeenCalled();

        expect(
          lastUpdate(getUpdates),
        ).toMatchObject({
          status: "failed",
          error_message:
            "シーン1の生成に失敗しました（レート制限）",
        });
      },
    );
  },
);