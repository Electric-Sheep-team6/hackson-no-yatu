"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = { userEmail: string | null; onMessage: (message: string) => void; onSignedIn: (email: string | null) => void };

export function AuthControls({ userEmail, onMessage, onSignedIn }: Props) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [loading, setLoading] = useState(false);
  const authenticate = async (mode: "signIn" | "signUp") => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = mode === "signIn" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
      if (error) throw error;
      onSignedIn(data.user?.email ?? null); setPassword("");
      onMessage(mode === "signUp" && !data.session ? "確認メールを送信しました。メールを確認してからログインしてください。" : mode === "signUp" ? "アカウントを作成しました。" : "ログインしました。");
    } catch (error) { onMessage(error instanceof Error ? error.message : "ログインに失敗しました。"); }
    finally { setLoading(false); }
  };
  if (userEmail) return <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">{userEmail}</span>;
  return <div className="flex flex-wrap items-center justify-end gap-2">
    <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="メールアドレス" className="w-36 rounded-full border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500" />
    <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="パスワード" className="w-28 rounded-full border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500" />
    <button type="button" onClick={() => authenticate("signIn")} disabled={loading || !email || !password} className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 disabled:opacity-50">{loading ? "ログイン中" : "ログイン"}</button>
    <button type="button" onClick={() => authenticate("signUp")} disabled={loading || !email || !password} className="text-xs text-cyan-200 underline disabled:opacity-50">新規登録</button>
  </div>;
}
