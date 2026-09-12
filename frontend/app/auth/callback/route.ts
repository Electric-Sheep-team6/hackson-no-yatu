import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null, origin: string) {
  if (!value) return "/";

  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) return "/";

    const resolved = new URL(decoded, origin);
    if (resolved.origin !== origin) return "/";

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), url.origin);

  if (!code) {
    return NextResponse.redirect(new URL("/login?auth_error=missing_code", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?auth_error=confirmation_failed", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
