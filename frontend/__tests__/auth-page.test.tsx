import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { AuthPage } from "@/app/components/AuthPage";

describe("AuthPage", () => {
  it("shows only the dedicated authentication experience", () => {
    render(<AuthPage nextPath="/" authError={null} />);

    expect(screen.getByRole("heading", { name: /続きを、はじめよう/i })).toBeDefined();
    expect(screen.getByLabelText("メールアドレス")).toBeDefined();
    expect(screen.getByLabelText("パスワード")).toBeDefined();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeDefined();
    expect(screen.queryByLabelText(/今日の記憶/i)).toBeNull();
  });

  it("explains a failed confirmation callback", () => {
    render(<AuthPage nextPath="/" authError="confirmation_failed" />);
    expect(screen.getByRole("alert").textContent).toContain("メールアドレスを確認できませんでした");
  });
});
