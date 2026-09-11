"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { MediaItem, Movie, Obsession } from "@/app/types/last-screen";

const errorMessage = async (response: Response) => (await response.json().catch(() => null))?.message ?? "通信に失敗しました。もう一度お試しください。";

export function useLastScreenFlow() {
  const [diary, setDiary] = useState("");
  const [lastSavedDiary, setLastSavedDiary] = useState<string | null>(null);
  const [uploadedMedia, setUploadedMedia] = useState<MediaItem[]>([]);
  const [obsessions, setObsessions] = useState<Obsession[]>([]);
  const [selectedObsession, setSelectedObsession] = useState<Obsession | null>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const saveInputs = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("ログインしてから分析してください");
    if (diary.trim() && diary.trim() !== lastSavedDiary) {
      const response = await fetch("/api/diaries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: diary.trim() }) });
      if (!response.ok) throw new Error(await errorMessage(response));
      setLastSavedDiary(diary.trim());
    }
    for (const item of uploadedMedia.filter((media) => !media.storagePath)) {
      const extension = item.file.name.split(".").pop()?.toLowerCase() || "bin";
      const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("photos").upload(storagePath, item.file, { contentType: item.file.type || undefined });
      if (error) throw error;
      const response = await fetch("/api/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath }) });
      if (!response.ok) throw new Error(await errorMessage(response));
      setUploadedMedia((current) => current.map((media) => media.id === item.id ? { ...media, storagePath } : media));
    }
  };

  const analyze = async () => {
    if (!diary.trim() && uploadedMedia.length === 0) return setMessage("日記または写真・動画を追加してください。");
    setIsAnalyzing(true); setMessage(null);
    try {
      await saveInputs();
      const response = await fetch("/api/obsessions", { method: "POST" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const obsession = await response.json() as Obsession;
      setObsessions((current) => [obsession, ...current]); setSelectedObsession(obsession); setMessage("偏愛を分析しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "分析に失敗しました。"); }
    finally { setIsAnalyzing(false); }
  };

  const generate = async () => {
    if (!selectedObsession) return setMessage("先に偏愛を分析して選択してください。");
    setIsGenerating(true); setMessage(null);
    try {
      const response = await fetch("/api/movies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ obsessionId: selectedObsession.id }) });
      if (!response.ok) throw new Error(await errorMessage(response));
      const { id } = await response.json() as { id: string };
      setMovie({ id, status: "pending", errorMessage: null, movie: null });
    } catch (error) { setIsGenerating(false); setMessage(error instanceof Error ? error.message : "映画生成を開始できませんでした。"); }
  };

  const addMedia = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(event.target.files ?? []).map((file) => ({ id: crypto.randomUUID(), name: file.name, type: file.type.startsWith("video") ? "video" : "image", file, previewUrl: file.type.startsWith("video") ? undefined : URL.createObjectURL(file) } satisfies MediaItem));
    if (next.length) { setUploadedMedia((current) => [...current, ...next]); event.target.value = ""; }
  };

  useEffect(() => { try { void createClient().auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)); } catch { /* env validation occurs on interaction */ } }, []);
  useEffect(() => {
    if (!movie || ["completed", "failed"].includes(movie.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/movies/${movie.id}`);
      if (!response.ok) return;
      const nextMovie = await response.json() as Movie;
      setMovie(nextMovie);
      if (["completed", "failed"].includes(nextMovie.status)) { setIsGenerating(false); setMessage(nextMovie.status === "completed" ? "映画の生成が完了しました。" : nextMovie.errorMessage ?? "映画の生成に失敗しました。"); }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [movie]);

  const detectedSignals = useMemo(() => uploadedMedia.length === 0 && !diary.trim()
    ? ["アップロードされた写真や動画から、繰り返し現れる場面を見つけます", "日記の中で、同じ人物・同じ景色・同じ時間がどれだけ強く印象に残っているかを確認します", "AIが最も深い感情を持つ1%を選び、最後の映画の土台にします"]
    : ["繰り返し現れる場所や人物", "季節や時間帯の再現性", "本人の記憶に最も強く残る音や光"], [diary, uploadedMedia]);

  return { diary, setDiary, uploadedMedia, obsessions, selectedObsession, setSelectedObsession, movie, isAnalyzing, isGenerating, message, userEmail, addMedia, analyze, generate, detectedSignals, setMessage };
}
