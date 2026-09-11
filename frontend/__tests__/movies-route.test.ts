import { beforeEach, describe, expect, it, vi } from "vitest";

const { afterMock, createAdminClientMock, createClientMock } = vi.hoisted(
  () => ({
    afterMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    createClientMock: vi.fn(),
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
          : { insert },
      ),
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
  });
});
