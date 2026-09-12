import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMovieFlow } from "@/app/hooks/useMovieFlow";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

const originalFetch = global.fetch;

describe("useMovieFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "saku@example.com" } },
        }),
      },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("ログイン状態の復元時に最新の偏愛と完成済み映画も復元する", async () => {
    const responses = new Map<string, unknown>([
      ["/api/diaries", { items: [] }],
      ["/api/photos", { items: [] }],
      [
        "/api/obsessions",
        {
          items: [
            {
              id: "obsession-1",
              title: "夜の散歩",
              reason: "繰り返し記録されているため",
            },
          ],
        },
      ],
      [
        "/api/movies",
        { items: [{ id: "movie-1", status: "completed" }] },
      ],
      [
        "/api/movies/movie-1",
        {
          id: "movie-1",
          status: "completed",
          errorMessage: null,
          videoUrl: "https://example.com/movie.mp4",
          movie: { title: "夜の散歩", scenes: [] },
        },
      ],
    ]);
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify(responses.get(path)), { status: 200 });
    }) as typeof fetch;

    const { result } = renderHook(() => useMovieFlow());

    await waitFor(() => {
      expect(result.current.userEmail).toBe("saku@example.com");
      expect(result.current.obsession?.id).toBe("obsession-1");
      expect(result.current.movie?.id).toBe("movie-1");
    });

    expect(result.current.movie?.videoUrl).toBe(
      "https://example.com/movie.mp4",
    );
    expect(global.fetch).toHaveBeenCalledWith("/api/movies/movie-1");
  });
});
