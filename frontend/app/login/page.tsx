import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthPage } from "@/app/components/AuthPage";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "ログイン | Made in 冥途",
  description: "Made in 冥途へログインします。",
};

type LoginPageProps = {
  searchParams: Promise<{ next?: string | string[]; auth_error?: string | string[] }>;
};

function safeNextPath(value: string | string[] | undefined) {
  if (typeof value !== "string") return "/";

  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith("/") && !decoded.startsWith("//") && !decoded.includes("\\") ? decoded : "/";
  } catch {
    return "/";
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/");

  const params = await searchParams;
  const authError = typeof params.auth_error === "string" ? params.auth_error : null;

  return <AuthPage nextPath={safeNextPath(params.next)} authError={authError} />;
}
