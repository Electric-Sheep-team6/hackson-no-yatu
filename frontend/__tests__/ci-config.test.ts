import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GitHub Actions configuration", () => {
  it("Supabase migration changes trigger both push and pull request CI", async () => {
    const workflow = await readFile(
      resolve(process.cwd(), "../.github/workflows/frontend-ci.yml"),
      "utf8",
    );

    expect(workflow.match(/- "supabase\/\*\*"/g)).toHaveLength(2);
  });
});
