"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { emailSchema } from "@/lib/validation";

type AuthPageProps = {
  nextPath: string;
  authError: string | null;
};

const CALLBACK_ERRORS: Record<string, string> = {
  missing_code: "確認リンクが正しくありません。もう一度ログインしてください。",
  confirmation_failed: "メールアドレスを確認できませんでした。確認リンクをもう一度お試しください。",
};

export function AuthPage({ nextPath, authError }: AuthPageProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"signIn" | "signUp" | null>(null);
  const [message, setMessage] = useState<string | null>(authError ? CALLBACK_ERRORS[authError] ?? "認証を完了できませんでした。" : null);
  const [messageTone, setMessageTone] = useState<"error" | "info">(authError ? "error" : "info");

  const authenticate = async (mode: "signIn" | "signUp") => {
    if (busy) return;

    const normalizedEmail = email.trim();
    if (!emailSchema.safeParse(normalizedEmail).success) {
      setMessageTone("error");
      setMessage("メールアドレスの形式を確認してください。");
      return;
    }

    setBusy(mode);
    setMessage(null);

    try {
      const supabase = createClient();
      const { data, error } = mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        : await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
            },
          });

      if (error) throw error;

      if (data.session) {
        router.replace(nextPath);
        router.refresh();
        return;
      }

      setPassword("");
      setMessageTone("info");
      setMessage(`${normalizedEmail} 宛に確認メールを送りました。メール内のリンクを開いてください。`);
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "認証に失敗しました。");
    } finally {
      setBusy(null);
    }
  };

  const submitLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void authenticate("signIn");
  };

  return (
    <main className="auth-shell">
      <div className="auth-cloud auth-cloud-left" aria-hidden="true" />
      <div className="auth-cloud auth-cloud-right" aria-hidden="true" />
      <div className="auth-page-frame">
        <a className="brand-mark auth-brand" href="/login" aria-label="Made in 冥途 ログイン">
          <span>Made in 冥途</span>
          <small>たきささえ</small>
        </a>

        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-copy">
            <p className="hero-kicker">100歳のわたしへ贈る</p>
            <h1 id="auth-title">続きを、<br />はじめよう。</h1>
            <p>あなたの記録と映画は、ログインした先だけに表示されます。</p>
          </div>

          <form className="auth-form" onSubmit={submitLogin}>
            <p className="eyebrow">SIGN IN</p>
            <label htmlFor="auth-email">メールアドレス</label>
            <input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
            <label htmlFor="auth-password">パスワード</label>
            <input id="auth-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="パスワードを入力" required />

            {message && <p role={messageTone === "error" ? "alert" : "status"} className={`auth-message auth-message-${messageTone}`}>{message}</p>}

            <button type="submit" className="button auth-submit" disabled={Boolean(busy) || !email || !password}>{busy === "signIn" ? "ログイン中..." : "ログイン"}</button>
            <div className="auth-divider"><span>または</span></div>
            <button type="button" className="auth-create" disabled={Boolean(busy) || !email || !password} onClick={() => void authenticate("signUp")}>{busy === "signUp" ? "作成中..." : "この内容でアカウントを作る"}</button>
          </form>
        </section>

        <p className="auth-footnote">あなたの人生の記録は、あなたのアカウントに保存されます。</p>
      </div>
    </main>
  );
}
