import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserMock, redirectMock, routerReplaceMock, routerRefreshMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  routerReplaceMock: vi.fn(),
  routerRefreshMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ replace: routerReplaceMock, refresh: routerRefreshMock }),
}));

import Home from "@/app/page";

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render the product UI for an unauthenticated request", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("renders the LAST SCREEN product flow for an authenticated user", async () => {
    getUserMock.mockResolvedValue({ data: { user: { email: "viewer@example.com" } } });
    render(await Home());

    expect(screen.getByRole("heading", { level: 1, name: /人生の最終上映/i })).toBeDefined();
    expect(screen.getByText("viewer@example.com")).toBeDefined();
    expect(screen.getByLabelText(/今日の記憶/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /わたしの偏愛を見つける/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /人生の映画をつくる/i })).toBeDefined();
  });
});
