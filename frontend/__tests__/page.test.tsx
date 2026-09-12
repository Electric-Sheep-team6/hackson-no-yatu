import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Home from "@/app/page";

describe("Home", () => {
  it("renders the LAST SCREEN product flow", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Made in 冥途/i,
      }),
    ).toBeDefined();
    expect(screen.getByLabelText(/今日の出来事/i)).toBeDefined();
    expect(screen.getByText("ログインなしで利用可能")).toBeDefined();
    expect(screen.getByRole("link", { name: "ログイン" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "新規登録" }).getAttribute("href")).toBe("/signup");
    expect(screen.getByRole("button", { name: /偏愛を分析/i })).toBeDefined();
  });

  it("adds uploaded media even when crypto.randomUUID is unavailable", () => {
    const originalCrypto = globalThis.crypto;
    const originalCreateObjectURL = globalThis.URL.createObjectURL;

    Object.defineProperty(globalThis, "crypto", {
      value: {},
      configurable: true,
    });
    Object.defineProperty(globalThis.URL, "createObjectURL", {
      value: vi.fn(() => "/preview.png"),
      configurable: true,
    });

    try {
      render(<Home />);

      const input = document.querySelector('input[type="file"]');
      expect(input).toBeTruthy();

      const file = new File(["hello"], "sample.png", { type: "image/png" });
      fireEvent.change(input!, { target: { files: [file] } });

      expect(screen.getAllByText("sample.png").length).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
      Object.defineProperty(globalThis.URL, "createObjectURL", {
        value: originalCreateObjectURL,
        configurable: true,
      });
    }
  });
});
