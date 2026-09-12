import { describe, expect, it } from "vitest";

import { createDiarySchema, emailSchema } from "@/lib/validation";

describe("emailSchema", () => {
  it("accepts a valid email address", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
  });

  it("rejects an invalid email address", () => {
    expect(emailSchema.safeParse("invalid-email").success).toBe(false);
  });
});

describe("createDiarySchema", () => {
  it("前後の空白を除去する", () => {
    expect(createDiarySchema.parse({ content: "  記録  " })).toEqual({
      content: "記録",
    });
  });

  it("空白だけの日記を拒否する", () => {
    expect(createDiarySchema.safeParse({ content: " \n\t " }).success).toBe(
      false,
    );
  });
});
