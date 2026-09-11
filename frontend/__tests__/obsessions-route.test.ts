import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyzeObsessionMock, createAdminClientMock, createClientMock } =
  vi.hoisted(() => ({
    analyzeObsessionMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    createClientMock: vi.fn(),
  }));

vi.mock("@/lib/ai/analyzeObsession", () => ({
  analyzeObsession: analyzeObsessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { POST } from "@/app/api/obsessions/route";

describe("POST /api/obsessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RLSでINSERTできない利用者クライアントではなく管理クライアントで保存する", async () => {
    const diaryLimit = vi.fn().mockResolvedValue({
      data: [{ content: "雨上がりの駅まで歩いた" }],
      error: null,
    });
    const photoLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const userFrom = vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: table === "diaries" ? diaryLimit : photoLimit,
          })),
        })),
      })),
    }));
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: userFrom,
      storage: { from: vi.fn() },
    });

    analyzeObsessionMock.mockResolvedValue({
      title: "雨上がりの帰り道",
      reason: "繰り返し記録されているためです。",
    });

    const insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: "obsession-1",
            title: "雨上がりの帰り道",
            reason: "繰り返し記録されているためです。",
            created_at: "2026-09-11T00:00:00.000Z",
          },
          error: null,
        }),
      })),
    }));
    const adminFrom = vi.fn(() => ({ insert }));
    createAdminClientMock.mockReturnValue({ from: adminFrom });

    const response = await POST();

    expect(response.status).toBe(201);
    expect(adminFrom).toHaveBeenCalledWith("obsessions");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1" }),
    );
    expect(userFrom).not.toHaveBeenCalledWith("obsessions");
    expect(diaryLimit).toHaveBeenCalledWith(50);
    expect(photoLimit).toHaveBeenCalledWith(12);
  });
});
