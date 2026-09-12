"use client";

import { type ChangeEvent, useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { emailSchema } from "@/lib/validation";

type Diary = { id: string; content: string; createdAt: string };
type PhotoPreview = { id: string; name: string; previewUrl: string };
type Obsession = { id: string; title: string; reason: string };
type Movie = { id: string; status: string; errorMessage: string | null; videoUrl: string | null; movie: { title: string; scenes: { order: number; source: string; narration: string }[] } | null };
type Busy = "auth" | "diary" | "upload" | "analysis" | "movie" | null;

async function responseError(response: Response) {
  return (await response.json().catch(() => null))?.message ?? "通信に失敗しました。";
}

export function useMovieFlow() {
  const [diaryDraft, setDiaryDraft] = useState("");
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [videoCount, setVideoCount] = useState(0);
  const [newPhotos, setNewPhotos] = useState<PhotoPreview[]>([]);
  const [obsession, setObsession] = useState<Obsession | null>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    const [diariesResponse, photosResponse, videosResponse] = await Promise.all([fetch("/api/diaries"), fetch("/api/photos"), fetch("/api/videos")]);
    if (diariesResponse.ok) setDiaries((await diariesResponse.json() as { items: Diary[] }).items);
    if (photosResponse.ok) setPhotoCount((await photosResponse.json() as { items: unknown[] }).items.length);
    if (videosResponse.ok) setVideoCount((await videosResponse.json() as { items: unknown[] }).items.length);
  }, []);

  const authenticate = async (mode: "signIn" | "signUp") => {
    const normalizedEmail = email.trim();
    if (!emailSchema.safeParse(normalizedEmail).success) {
      setMessage("メールアドレスの形式が正しくありません。");
      return;
    }
    setBusy("auth"); setMessage(null);
    try {
      const supabase = createClient();
      const { data, error } = mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        : await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
          });
      if (error) throw error;
      setUserEmail(data.session?.user.email ?? null); setPassword("");
      if (data.session) await refreshLibrary();
      setMessage(mode === "signUp" && !data.session ? "確認メールを送信しました。確認後にログインしてください。" : mode === "signUp" ? "アカウントを作成しました。" : "ログインしました。保存済みの記録を読み込みました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "認証に失敗しました。"); }
    finally { setBusy(null); }
  };

  const saveDiary = async () => {
    if (!diaryDraft.trim()) return;
    setBusy("diary"); setMessage(null);
    try {
      const response = await fetch("/api/diaries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: diaryDraft.trim() }) });
      if (!response.ok) throw new Error(await responseError(response));
      const diary = await response.json() as Diary;
      setDiaries((current) => [diary, ...current]); setDiaryDraft(""); setMessage("日記を保存しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "日記を保存できませんでした。"); }
    finally { setBusy(null); }
  };

  const uploadPhotos = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy("upload"); setMessage(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("ログインしてから写真を追加してください。");
      const previews: PhotoPreview[] = [];
      for (const file of files) {
        const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from("photos").upload(storagePath, file, { contentType: file.type });
        if (error) throw error;
        const response = await fetch("/api/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath }) });
        if (!response.ok) throw new Error(await responseError(response));
        previews.push({ id: crypto.randomUUID(), name: file.name, previewUrl: URL.createObjectURL(file) });
      }
      setNewPhotos((current) => [...previews, ...current]); setPhotoCount((count) => count + previews.length); setMessage(`${previews.length}枚の写真を保存しました。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "写真を保存できませんでした。"); }
    finally { setBusy(null); }
  };

  const uploadVideos = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (files.some((file) => file.size > 25 * 1024 * 1024)) {
      setMessage("動画は1本25MB以下にしてください。");
      return;
    }
    setBusy("upload"); setMessage(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("ログインしてから動画を追加してください。");
      for (const file of files) {
        const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
        const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from("videos").upload(storagePath, file, { contentType: file.type });
        if (error) throw error;
        const response = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath }) });
        if (!response.ok) throw new Error(await responseError(response));
      }
      setVideoCount((count) => count + files.length);
      setMessage(`${files.length}本の動画を保存しました。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "動画を保存できませんでした。"); }
    finally { setBusy(null); }
  };

  const analyze = async () => {
    if (diaries.length + photoCount + videoCount === 0) return setMessage("先に日記・写真・動画のいずれかを保存してください。");
    setBusy("analysis"); setMessage(null);
    try {
      const response = await fetch("/api/obsessions", { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response));
      const next = await response.json() as Obsession;
      setObsession(next); setMessage(`${diaries.length}件の日記と${photoCount}枚の写真を分析し、${videoCount}本の動画を編集素材として準備しました。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "分析に失敗しました。"); }
    finally { setBusy(null); }
  };

  const generate = async () => {
    if (!obsession) return setMessage("先に偏愛を分析してください。");
    if (photoCount === 0) return setMessage("映画生成には、人物の記録写真を1枚以上追加してください。");
    setBusy("movie"); setMessage(null);
    try {
      const response = await fetch("/api/movies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ obsessionId: obsession.id }) });
      if (!response.ok) throw new Error(await responseError(response));
      const created = await response.json() as { id: string; status: string };
      setMovie({ ...created, errorMessage: null, videoUrl: null, movie: null }); setMessage("映画の生成を開始しました。完了までお待ちください。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "映画生成を開始できませんでした。"); setBusy(null); }
  };

  useEffect(() => { try { void createClient().auth.getUser().then(({ data }) => { setUserEmail(data.user?.email ?? null); if (data.user) void refreshLibrary(); }); } catch { /* env is validated when used */ } }, [refreshLibrary]);
  useEffect(() => {
    if (!movie || ["completed", "failed"].includes(movie.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/movies/${movie.id}`);
      if (!response.ok) return;
      const next = await response.json() as Movie;
      setMovie(next);
      if (["completed", "failed"].includes(next.status)) { setBusy(null); setMessage(next.status === "completed" ? "映画が完成しました。" : next.errorMessage ?? "映画生成に失敗しました。"); }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [movie]);

  return { diaryDraft, setDiaryDraft, diaries, photoCount, videoCount, newPhotos, obsession, movie, email, setEmail, password, setPassword, userEmail, busy, message, authenticate, saveDiary, uploadPhotos, uploadVideos, analyze, generate };
}
