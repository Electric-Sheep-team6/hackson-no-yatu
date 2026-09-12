import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { GET } from "@/app/auth/callback/route";

describe("認証コールバック", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    });
  });

  it("同一サイト内のnextパスへリダイレクトする", async () => {
    const response = await GET(
      new Request("https://app.example/auth/callback?code=valid&next=%2Fmovies%3Ftab%3Dmine"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/movies?tab=mine");
  });

  it.each([
    ["プロトコル相対URL", "%2F%2Fevil.example"],
    ["バックスラッシュを含むURL", "%2F%5Cevil.example"],
  ])("%sを指定されても外部サイトへリダイレクトしない", async (_label, next) => {
    const response = await GET(
      new Request(`https://app.example/auth/callback?code=valid&next=${next}`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/");
  });
});
