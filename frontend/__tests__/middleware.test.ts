import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

import { proxy } from "@/proxy";

describe("session refresh middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  it("更新したセッションCookieを現在のrequestとresponseの両方へ反映する", async () => {
    createServerClientMock.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: vi.fn(async () => {
          options.cookies.setAll([
            {
              name: "sb-session",
              value: "fresh-session",
              options: { httpOnly: true, path: "/" },
            },
          ]);

          expect(options.cookies.getAll()).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: "sb-session",
                value: "fresh-session",
              }),
            ]),
          );
          return { data: { user: { id: "user-1" } }, error: null };
        }),
      },
    }));

    const request = new NextRequest("https://app.example/api/diaries", {
      headers: { cookie: "sb-session=stale-session" },
    });
    const response = await proxy(request);

    expect(request.cookies.get("sb-session")?.value).toBe("fresh-session");
    expect(response.cookies.get("sb-session")?.value).toBe("fresh-session");
  });
});
