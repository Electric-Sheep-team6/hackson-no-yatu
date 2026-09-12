import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { POST as createDiary } from "@/app/api/diaries/route";
import { POST as createPhoto } from "@/app/api/photos/route";

describe("日記・写真投稿API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ログインユーザーの日記を保存して画面用の形式で返す", async () => {
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "diary-1",
            content: "雨上がりの夜道を歩いた",
            created_at: "2026-09-12T00:00:00.000Z",
          },
          error: null,
        }),
      })),
    }));
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({ insert })),
    });

    const response = await createDiary(
      new Request("http://localhost/api/diaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "雨上がりの夜道を歩いた" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      content: "雨上がりの夜道を歩いた",
    });
    await expect(response.json()).resolves.toEqual({
      id: "diary-1",
      content: "雨上がりの夜道を歩いた",
      createdAt: "2026-09-12T00:00:00.000Z",
    });
  });

  it("空白だけの日記を保存しない", async () => {
    const from = vi.fn();
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
    });

    const response = await createDiary(
      new Request("http://localhost/api/diaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "  \n\t  " }),
      }),
    );

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("本人のStorageパスだけを写真メタデータとして保存する", async () => {
    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "photo-1",
            storage_path: "user-1/night.jpg",
            diary_id: null,
            created_at: "2026-09-12T00:01:00.000Z",
          },
          error: null,
        }),
      })),
    }));
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({ insert })),
      storage: {
        from: vi.fn(() => ({
          exists: vi.fn().mockResolvedValue({ data: true, error: null }),
        })),
      },
    });

    const response = await createPhoto(
      new Request("http://localhost/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: "user-1/night.jpg" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      storage_path: "user-1/night.jpg",
      diary_id: null,
    });
  });

  it("Storageに存在しない写真をメタデータへ登録しない", async () => {
    const from = vi.fn();
    const exists = vi.fn().mockResolvedValue({ data: false, error: null });
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
      storage: { from: vi.fn(() => ({ exists })) },
    });

    const response = await createPhoto(
      new Request("http://localhost/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: "user-1/missing.jpg" }),
      }),
    );

    expect(exists).toHaveBeenCalledWith("user-1/missing.jpg");
    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("別ユーザーのStorageパスは保存しない", async () => {
    const from = vi.fn();
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
    });

    const response = await createPhoto(
      new Request("http://localhost/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath: "user-2/stolen.jpg" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["user-1", "user-1/", "user-1/folder/photo.jpg"])(
    "不正なStorageパス %s は保存しない",
    async (storagePath) => {
      const from = vi.fn();
      createClientMock.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user-1" } },
            error: null,
          }),
        },
        from,
      });

      const response = await createPhoto(
        new Request("http://localhost/api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath }),
        }),
      );

      expect(response.status).toBe(403);
      expect(from).not.toHaveBeenCalled();
    },
  );
});
