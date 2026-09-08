import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("Home", () => {
  it("renders the LAST SCREEN product flow", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /人生の最後に観る映画を、人生をかけて作る。/i,
      }),
    ).toBeDefined();
    expect(screen.getByLabelText(/今日の出来事/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /偏愛を分析/i })).toBeDefined();
  });
});
