import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchangeCodeForSessionMock } = vi.hoisted(() => ({
  exchangeCodeForSessionMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: exchangeCodeForSessionMock },
  }),
}));

import { GET } from "@/app/auth/callback/route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
  });

  it("sends a missing-code error to the login page", async () => {
    const response = await GET(new Request("https://example.com/auth/callback"));
    expect(response.headers.get("location")).toBe("https://example.com/login?auth_error=missing_code");
  });

  it("sends a failed confirmation to the login page", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: new Error("invalid code") });
    const response = await GET(new Request("https://example.com/auth/callback?code=bad"));
    expect(response.headers.get("location")).toBe("https://example.com/login?auth_error=confirmation_failed");
  });

  it("rejects a backslash-based external redirect", async () => {
    const response = await GET(new Request("https://example.com/auth/callback?code=ok&next=%2F%5Cevil.example"));
    expect(response.headers.get("location")).toBe("https://example.com/");
  });

  it("preserves a safe same-origin path", async () => {
    const response = await GET(new Request("https://example.com/auth/callback?code=ok&next=%2F%3Ffrom%3Dlogin"));
    expect(response.headers.get("location")).toBe("https://example.com/?from=login");
  });
});
