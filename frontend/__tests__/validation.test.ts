import { describe, expect, it } from "vitest";

import { emailSchema } from "@/lib/validation";

describe("emailSchema", () => {
  it("accepts a valid email address", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
  });

  it("rejects an invalid email address", () => {
    expect(emailSchema.safeParse("invalid-email").success).toBe(false);
  });
});
