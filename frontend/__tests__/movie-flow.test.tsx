import {
  cleanup,
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MovieApp } from "@/app/components/MovieApp";
import { useMovieFlow } from "@/app/hooks/useMovieFlow";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

const originalFetch = global.fetch;

describe("useMovieFlow", () => {
  const removeMock = vi.fn();
  const uploadMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    removeMock.mockResolvedValue({ error: null });
    uploadMock.mockResolvedValue({ error: null });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "saku@example.com" } },
        }),
      },
      storage: {
        from: vi.fn(() => ({ remove: removeMock, upload: uploadMock })),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it("一部の取得が通信失敗しても残りのライブラリを復元する", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      if (path === "/api/photos") throw new Error("network unavailable");
      if (path === "/api/diaries") {
        return Response.json({
          items: [
            {
              id: "diary-1",
              content: "復元された日記",
              createdAt: "2026-09-12T00:00:00.000Z",
            },
          ],
        });
      }
      if (path === "/api/obsessions") {
        return Response.json({
          items: [
            {
              id: "obsession-1",
              title: "復元された偏愛",
              reason: "日記に繰り返し現れるため",
            },
          ],
        });
      }
      return Response.json({ items: [] });
    }) as typeof fetch;

    const { result } = renderHook(() => useMovieFlow());

    await waitFor(() => {
      expect(result.current.diaries[0]?.id).toBe("diary-1");
      expect(result.current.obsession?.id).toBe("obsession-1");
    });
    expect(result.current.photoCount).toBe(0);
  });

  it("セッション確認の通信失敗を未処理にせず画面へ通知する", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockRejectedValue(new Error("network unavailable")),
      },
    });

    const { result } = renderHook(() => useMovieFlow());

    await waitFor(() => {
      expect(result.current.message).toEqual({
        text: "ログイン状態を確認できませんでした。通信環境を確認してください。",
        tone: "error",
        area: "auth",
      });
    });
    expect(result.current.userEmail).toBeNull();
  });

  it("ログアウト後に遅延した旧ユーザーのライブラリを再表示しない", async () => {
    const libraryResolvers = new Map<
      string,
      (response: Response) => void
    >();
    const signOut = vi.fn().mockResolvedValue({ error: null });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "saku@example.com" } },
        }),
        signOut,
      },
      storage: {
        from: vi.fn(() => ({ remove: removeMock, upload: uploadMock })),
      },
    });
    global.fetch = vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          libraryResolvers.set(input.toString(), resolve);
        }),
    ) as typeof fetch;

    const { result } = renderHook(() => useMovieFlow());
    await waitFor(() => expect(result.current.userEmail).toBe("saku@example.com"));

    await act(async () => result.current.signOut());
    expect(result.current.userEmail).toBeNull();

    await act(async () => {
      libraryResolvers.get("/api/diaries")?.(
        Response.json({
          items: [
            {
              id: "private-diary",
              content: "旧ユーザーだけの記録",
              createdAt: "2026-09-12T00:00:00.000Z",
            },
          ],
        }),
      );
      libraryResolvers.get("/api/photos")?.(Response.json({ items: [] }));
      libraryResolvers.get("/api/obsessions")?.(Response.json({ items: [] }));
      libraryResolvers.get("/api/movies")?.(Response.json({ items: [] }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(signOut).toHaveBeenCalledOnce();
    expect(result.current.diaries).toEqual([]);
    expect(result.current.obsession).toBeNull();
    expect(result.current.movie).toBeNull();
  });

  it("日記と画像の投稿から偏愛分析、映画完成まで画面操作で実行する", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";

        if (method === "GET" && path === "/api/diaries") {
          return Response.json({ items: [] });
        }
        if (method === "GET" && path === "/api/photos") {
          return Response.json({ items: [] });
        }
        if (method === "GET" && path === "/api/obsessions") {
          return Response.json({ items: [] });
        }
        if (method === "GET" && path === "/api/movies") {
          return Response.json({ items: [] });
        }
        if (method === "POST" && path === "/api/diaries") {
          return Response.json(
            {
              id: "diary-1",
              content: "雨上がりの夜道を歩いた",
              createdAt: "2026-09-12T00:00:00.000Z",
            },
            { status: 201 },
          );
        }
        if (method === "POST" && path === "/api/photos") {
          return Response.json({ id: "photo-1" }, { status: 201 });
        }
        if (method === "POST" && path === "/api/obsessions") {
          return Response.json(
            {
              id: "obsession-1",
              title: "雨上がりの夜道",
              reason: "日記と写真に繰り返し現れるため",
            },
            { status: 201 },
          );
        }
        if (method === "POST" && path === "/api/movies") {
          return Response.json(
            { id: "movie-1", status: "pending" },
            { status: 201 },
          );
        }
        if (method === "GET" && path === "/api/movies/movie-1") {
          return Response.json({
            id: "movie-1",
            status: "completed",
            errorMessage: null,
            videoUrl: "https://example.com/movie.mp4",
            movie: {
              title: "雨上がりの夜道",
              scenes: [
                { order: 1, source: "夜道", narration: "雨が上がる。" },
              ],
            },
          });
        }

        return Response.json(
          { message: `Unexpected request: ${method} ${path}` },
          { status: 500 },
        );
      },
    );
    global.fetch = fetchMock as typeof fetch;
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const { container } = render(<MovieApp />);

    await screen.findByText("saku@example.com");

    fireEvent.change(screen.getByLabelText("新しい日記"), {
      target: { value: "雨上がりの夜道を歩いた" },
    });
    fireEvent.click(screen.getByRole("button", { name: "日記を追加" }));
    await screen.findByText("雨上がりの夜道を歩いた");

    const photoInput = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    expect(photoInput).not.toBeNull();
    const photo = new File([new Uint8Array([1, 2, 3])], "night.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(photoInput!, { target: { files: [photo] } });
    await screen.findByAltText("night.jpg");

    fireEvent.click(screen.getByRole("button", { name: "偏愛を分析" }));
    await screen.findByRole("heading", { name: "雨上がりの夜道" });

    fireEvent.click(screen.getByRole("button", { name: "映画を生成" }));
    await waitFor(
      () => {
        expect(screen.getByText("映画が完成しました。")).toBeDefined();
      },
      { timeout: 3_000 },
    );

    const diaryRequest = fetchMock.mock.calls.find(
      ([path, init]) => path === "/api/diaries" && init?.method === "POST",
    );
    expect(JSON.parse(diaryRequest?.[1]?.body as string)).toEqual({
      content: "雨上がりの夜道を歩いた",
    });

    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\/[0-9a-f-]+\.jpg$/),
      photo,
      { contentType: "image/jpeg" },
    );
    const uploadedStoragePath = uploadMock.mock.calls[0][0] as string;
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/photos",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ storagePath: uploadedStoragePath }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/obsessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/movies",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ obsessionId: "obsession-1" }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/movies/movie-1");
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://example.com/movie.mp4",
    );
  });

  it("複数画像の途中で失敗しても保存済み画像を画面へ反映する", async () => {
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = typeof input === "string" ? input : input.toString();
        if (init?.method === "POST" && path === "/api/photos") {
          return Response.json({ id: "photo-1" }, { status: 201 });
        }
        return Response.json({ items: [] });
      },
    ) as typeof fetch;
    uploadMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("storage unavailable") });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:first-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const { container } = render(<MovieApp />);
    await screen.findByText("saku@example.com");

    const photoInput = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    expect(photoInput).not.toBeNull();
    const first = new File([new Uint8Array([1])], "first.jpg", {
      type: "image/jpeg",
    });
    const second = new File([new Uint8Array([2])], "second.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(photoInput!, { target: { files: [first, second] } });

    await screen.findByAltText("first.jpg");
    expect(screen.queryByAltText("second.jpg")).toBeNull();
    expect(screen.getByText("保存済み: 1枚")).toBeDefined();
    expect(
      screen.getByText(
        "1枚は保存しましたが、残りの写真を保存できませんでした。",
      ),
    ).toBeDefined();
  });

  it("前の映画状態リクエストが完了するまで次のポーリングを開始しない", async () => {
    let resolveMovieStatus: ((response: Response) => void) | undefined;
    let statusRequestCount = 0;
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = typeof input === "string" ? input : input.toString();
        if (init?.method === "POST" && path === "/api/movies") {
          return Response.json(
            { id: "movie-1", status: "pending" },
            { status: 201 },
          );
        }
        if (path === "/api/movies/movie-1") {
          statusRequestCount += 1;
          return new Promise<Response>((resolve) => {
            resolveMovieStatus = resolve;
          });
        }
        if (path === "/api/obsessions") {
          return Response.json({
            items: [
              {
                id: "obsession-1",
                title: "夜道",
                reason: "繰り返し現れるため",
              },
            ],
          });
        }
        return Response.json({ items: [] });
      },
    ) as typeof fetch;

    const { result } = renderHook(() => useMovieFlow());
    await waitFor(() => expect(result.current.obsession).not.toBeNull());

    vi.useFakeTimers();
    await act(async () => result.current.generate());
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(statusRequestCount).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(statusRequestCount).toBe(1);

    await act(async () => {
      resolveMovieStatus?.(
        Response.json({
          id: "movie-1",
          status: "completed",
          errorMessage: null,
          videoUrl: "https://example.com/movie.mp4",
          movie: null,
        }),
      );
      await Promise.resolve();
    });
    expect(result.current.movie?.status).toBe("completed");
  });

  it("写真メタデータの保存失敗時にStorage上の孤立ファイルを削除する", async () => {
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = typeof input === "string" ? input : input.toString();
        if (init?.method === "POST" && path === "/api/photos") {
          return Response.json(
            { message: "写真を記録できませんでした" },
            { status: 500 },
          );
        }
        return Response.json({ items: [] });
      },
    ) as typeof fetch;

    const { result } = renderHook(() => useMovieFlow());
    await waitFor(() => expect(result.current.userEmail).not.toBeNull());
    const photo = new File([new Uint8Array([1])], "orphan.jpg", {
      type: "image/jpeg",
    });

    await act(async () => {
      await result.current.uploadPhotos({
        target: { files: [photo], value: "" },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    const storagePath = uploadMock.mock.calls[0][0] as string;
    expect(removeMock).toHaveBeenCalledWith([storagePath]);
    expect(result.current.photoCount).toBe(0);
    expect(result.current.message?.text).toBe("写真を記録できませんでした");
  });

  it.each([
    ["text/plain", "note.txt"],
    ["image/gif", "animated.gif"],
  ])("AI非対応の%sファイルをStorageへ送信しない", async (type, name) => {
    global.fetch = vi.fn(async () => Response.json({ items: [] })) as typeof fetch;
    const { result } = renderHook(() => useMovieFlow());
    await waitFor(() => expect(result.current.userEmail).not.toBeNull());
    const unsupportedFile = new File(["unsupported image"], name, {
      type,
    });

    await act(async () => {
      await result.current.uploadPhotos({
        target: { files: [unsupportedFile], value: "" },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(result.current.message?.text).toBe(
      "JPEG、PNG、WebP形式の画像を選択してください。",
    );
  });
});
