import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock, createClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { GET } from "@/app/api/movies/[id]/route";

describe("GET /api/movies/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ポーリング時に制限時間超過ジョブを回収してから状態を返す", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "failed",
        video_path: null,
        error_message: "動画生成が制限時間を超えました",
        movie_json: null,
      },
      error: null,
    });
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle })),
          })),
        })),
      })),
    });
    const recoverStale = vi.fn().mockResolvedValue({ data: 1, error: null });
    createAdminClientMock.mockReturnValue({ rpc: recoverStale });

    const response = await GET(
      new Request("http://localhost/api/movies/11111111-1111-4111-8111-111111111111"),
      { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(recoverStale).toHaveBeenCalledWith(
      "recover_stale_movie_generations",
      { p_user_id: "user-1" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "failed",
      errorMessage: "動画生成が制限時間を超えました",
    });
  });

  it("completedの自分の映画にはauthenticatedクライアントで署名URLを付ける", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.example.com/signed-movie" },
      error: null,
    });
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "11111111-1111-4111-8111-111111111111",
                  status: "completed",
                  video_path: "user-1/movie-1.mp4",
                  error_message: null,
                  movie_json: {},
                },
                error: null,
              }),
            })),
          })),
        })),
      })),
      storage: {
        from: vi.fn(() => ({ createSignedUrl })),
      },
    });
    createAdminClientMock.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
    });

    const response = await GET(
      new Request("http://localhost/api/movies/11111111-1111-4111-8111-111111111111"),
      { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(createSignedUrl).toHaveBeenCalledWith("user-1/movie-1.mp4", 3600);
    await expect(response.json()).resolves.toMatchObject({
      videoUrl: "https://storage.example.com/signed-movie",
    });
  });
});
