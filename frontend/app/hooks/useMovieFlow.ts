"use client";

import { type ChangeEvent, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type MediaItem = { id: string; name: string; file: File; previewUrl: string; storagePath?: string };
type Obsession = { id: string; title: string; reason: string };
type Movie = { id: string; status: string; errorMessage: string | null; videoUrl: string | null; movie: { title: string; scenes: { order: number; source: string; narration: string }[] } | null };

async function responseError(response: Response) {
  return (await response.json().catch(() => null))?.message ?? "通信に失敗しました。";
}

export function useMovieFlow() {
  const [diary, setDiary] = useState("");
  const [lastSavedDiary, setLastSavedDiary] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [obsession, setObsession] = useState<Obsession | null>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<"auth" | "analysis" | "movie" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const authenticate = async (mode: "signIn" | "signUp") => {
    setBusy("auth"); setMessage(null);
    try {
      const supabase = createClient();
      const { data, error } = mode === "signIn" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
      if (error) throw error;
      setUserEmail(data.user?.email ?? null); setPassword("");
      setMessage(mode === "signUp" && !data.session ? "確認メールを送信しました。確認後にログインしてください。" : mode === "signUp" ? "アカウントを作成しました。" : "ログインしました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "認証に失敗しました。"); }
    finally { setBusy(null); }
  };

  const addMedia = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    setMedia((current) => [...current, ...files.map((file) => ({ id: crypto.randomUUID(), name: file.name, file, previewUrl: URL.createObjectURL(file) }))]);
    event.target.value = "";
  };

  const saveInputs = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("ログインしてから実行してください。");
    if (diary.trim() && diary.trim() !== lastSavedDiary) {
      const response = await fetch("/api/diaries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: diary.trim() }) });
      if (!response.ok) throw new Error(await responseError(response));
      setLastSavedDiary(diary.trim());
    }
    for (const item of media.filter((entry) => !entry.storagePath)) {
      const extension = item.file.name.split(".").pop()?.toLowerCase() || "jpg";
      const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("photos").upload(storagePath, item.file, { contentType: item.file.type });
      if (error) throw error;
      const response = await fetch("/api/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath }) });
      if (!response.ok) throw new Error(await responseError(response));
      setMedia((current) => current.map((entry) => entry.id === item.id ? { ...entry, storagePath } : entry));
    }
  };

  const analyze = async () => {
    if (!diary.trim() && media.length === 0) return setMessage("日記または写真を追加してください。");
    setBusy("analysis"); setMessage(null);
    try {
      await saveInputs();
      const response = await fetch("/api/obsessions", { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response));
      const next = await response.json() as Obsession;
      setObsession(next); setMessage("偏愛を分析しました。映画を生成できます。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "分析に失敗しました。"); }
    finally { setBusy(null); }
  };

  const generate = async () => {
    if (!obsession) return setMessage("先に偏愛を分析してください。");
    setBusy("movie"); setMessage(null);
    try {
      const response = await fetch("/api/movies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ obsessionId: obsession.id }) });
      if (!response.ok) throw new Error(await responseError(response));
      const created = await response.json() as { id: string; status: string };
      setMovie({ ...created, errorMessage: null, videoUrl: null, movie: null });
      setMessage("映画の生成を開始しました。完了までお待ちください。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "映画生成を開始できませんでした。"); setBusy(null); }
  };

  useEffect(() => { try { void createClient().auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)); } catch { /* env is validated when used */ } }, []);
  useEffect(() => {
    if (!movie || ["completed", "failed"].includes(movie.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/movies/${movie.id}`);
      if (!response.ok) return;
      const next = await response.json() as Movie;
      setMovie(next);
      if (["completed", "failed"].includes(next.status)) {
        setBusy(null);
        setMessage(next.status === "completed" ? "映画が完成しました。" : next.errorMessage ?? "映画生成に失敗しました。");
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [movie]);

  return { diary, setDiary, media, obsession, movie, email, setEmail, password, setPassword, userEmail, busy, message, authenticate, addMedia, analyze, generate };
}
