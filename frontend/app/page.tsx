"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type MediaItem = {
  id: string;
  name: string;
  type: "image" | "video";
  file: File;
  previewUrl?: string;
  storagePath?: string;
};

type Obsession = {
  id: string;
  title: string;
  reason: string;
  createdAt: string;
};

type Movie = {
  id: string;
  status: "pending" | "analyzing" | "generating" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  movie: {
    title: string;
    logline: string;
    scenes: { order: number; source: string; narration: string }[];
  } | null;
};

const defaultQuestions = [
  "この場面を最初に好きになったのはいつですか",
  "なぜ他の場所ではなく、ここが特別なのですか",
  "この人物や音、景色のどこが一番大事ですか",
  "もう一度だけ見られるなら、どの瞬間を残したいですか",
  "誰にも理解されなくても残したいものは何ですか",
];

export default function Home() {
  const [diary, setDiary] = useState("");
  const [lastSavedDiary, setLastSavedDiary] = useState<string | null>(null);
  const [uploadedMedia, setUploadedMedia] = useState<MediaItem[]>([]);
  const [obsessions, setObsessions] = useState<Obsession[]>([]);
  const [selectedObsession, setSelectedObsession] = useState<Obsession | null>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const getErrorMessage = async (response: Response) => {
    const body = await response.json().catch(() => null);
    return body?.message ?? "通信に失敗しました。もう一度お試しください。";
  };

  const saveInputs = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("ログインしてから分析してください");

    if (diary.trim() && diary.trim() !== lastSavedDiary) {
      const diaryResponse = await fetch("/api/diaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: diary.trim() }),
      });
      if (!diaryResponse.ok) throw new Error(await getErrorMessage(diaryResponse));
      setLastSavedDiary(diary.trim());
    }

    for (const item of uploadedMedia.filter((media) => !media.storagePath)) {
      const extension = item.file.name.split(".").pop()?.toLowerCase() || "bin";
      const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("photos")
        .upload(storagePath, item.file, { contentType: item.file.type || undefined });
      if (uploadError) throw uploadError;

      const photoResponse = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath }),
      });
      if (!photoResponse.ok) throw new Error(await getErrorMessage(photoResponse));
      setUploadedMedia((current) => current.map((media) =>
        media.id === item.id ? { ...media, storagePath } : media,
      ));
    }
  };

  const handleAnalyze = async () => {
    if (!diary.trim() && uploadedMedia.length === 0) {
      setMessage("日記または写真・動画を追加してください。");
      return;
    }
    setIsAnalyzing(true);
    setMessage(null);
    try {
      await saveInputs();
      const response = await fetch("/api/obsessions", { method: "POST" });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const obsession = await response.json() as Obsession;
      setObsessions((current) => [obsession, ...current]);
      setSelectedObsession(obsession);
      setMessage("偏愛を分析しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "分析に失敗しました。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedObsession) {
      setMessage("先に偏愛を分析して選択してください。");
      return;
    }
    setIsGenerating(true);
    setMessage(null);
    try {
      const response = await fetch("/api/movies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obsessionId: selectedObsession.id }),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const created = await response.json() as { id: string };
      setMovie({ id: created.id, status: "pending", errorMessage: null, movie: null });
    } catch (error) {
      setIsGenerating(false);
      setMessage(error instanceof Error ? error.message : "映画生成を開始できませんでした。");
    }
  };

  const handleAuth = async (mode: "signIn" | "signUp") => {
    setIsAuthenticating(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const { data, error } = mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (error) throw error;
      setUserEmail(data.user?.email ?? null);
      setPassword("");
      setMessage(mode === "signUp" && !data.session ? "確認メールを送信しました。メールを確認してからログインしてください。" : mode === "signUp" ? "アカウントを作成しました。" : "ログインしました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログインに失敗しました。");
    } finally {
      setIsAuthenticating(false);
    }
  };

  useEffect(() => {
    try {
      const supabase = createClient();
      void supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    } catch {
      // 環境変数未設定時は、操作時に案内を表示する。
    }
  }, []);

  useEffect(() => {
    if (!movie || ["completed", "failed"].includes(movie.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/movies/${movie.id}`);
      if (response.ok) {
        const nextMovie = await response.json() as Movie;
        setMovie(nextMovie);
        if (["completed", "failed"].includes(nextMovie.status)) {
          setIsGenerating(false);
          setMessage(
            nextMovie.status === "completed"
              ? "映画の生成が完了しました。"
              : nextMovie.errorMessage ?? "映画の生成に失敗しました。",
          );
        }
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [movie]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextMedia: MediaItem[] = Array.from(event.target.files ?? []).map((file) => {
      const isVideo = file.type.startsWith("video");

      return {
        id: crypto.randomUUID(),
        name: file.name,
        type: isVideo ? "video" : "image",
        file,
        previewUrl: isVideo ? undefined : URL.createObjectURL(file),
      } satisfies MediaItem;
    });

    if (nextMedia.length > 0) {
      setUploadedMedia((prev) => [...prev, ...nextMedia]);
      event.target.value = "";
    }
  };

  const detectedSignals = useMemo(() => {
    if (uploadedMedia.length === 0 && diary.trim().length === 0) {
      return [
        "アップロードされた写真や動画から、繰り返し現れる場面を見つけます",
        "日記の中で、同じ人物・同じ景色・同じ時間がどれだけ強く印象に残っているかを確認します",
        "AIが最も深い感情を持つ1%を選び、最後の映画の土台にします",
      ];
    }

    return [
      "繰り返し現れる場所や人物",
      "季節や時間帯の再現性",
      "本人の記憶に最も強く残る音や光",
    ];
  }, [diary, uploadedMedia]);

  return (
    <main className="min-h-screen bg-[#070b12] text-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Made in 冥途</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              人生の最後に観る映画を、人生をかけて作る。
            </h1>
          </div>
          {userEmail ? (
            <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
              {userEmail}
            </span>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="メールアドレス" className="w-36 rounded-full border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500" />
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="パスワード" className="w-28 rounded-full border border-white/15 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500" />
              <button type="button" onClick={() => handleAuth("signIn")} disabled={isAuthenticating || !email || !password} className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
                {isAuthenticating ? "ログイン中" : "ログイン"}
              </button>
              <button type="button" onClick={() => handleAuth("signUp")} disabled={isAuthenticating || !email || !password} className="text-xs text-cyan-200 underline disabled:opacity-50">新規登録</button>
            </div>
          )}
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/60 p-8 shadow-2xl shadow-black/40">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">偏愛探索</p>
                <h2 className="mt-2 text-3xl font-semibold text-white">AIが、好きの粒度を見つける</h2>
              </div>
              <div className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
                {uploadedMedia.length > 0 ? `${uploadedMedia.length}件のメディア` : "まだ未分析"}
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label htmlFor="diary" className="mb-2 block text-sm font-medium text-slate-200">
                    今日の出来事
                  </label>
                  <textarea
                    id="diary"
                    value={diary}
                    onChange={(event) => setDiary(event.target.value)}
                    rows={8}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500 focus:border-cyan-400/70"
                    placeholder="思い出や気分、繰り返し見返した場面を記録してください"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">写真・動画をアップロード</label>
                  <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-cyan-400/30 bg-cyan-500/5 px-4 py-6 text-sm text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-500/10">
                    <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleFileChange} />
                    画像や動画を選択
                  </label>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {uploadedMedia.length === 0 ? (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-400 sm:col-span-2">
                        まだアップロードされていません
                      </span>
                    ) : (
                      uploadedMedia.map((item) => (
                        <div key={item.id} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
                          {item.type === "image" && item.previewUrl ? (
                            <img src={item.previewUrl} alt={item.name} className="h-24 w-full object-cover" />
                          ) : (
                            <div className="flex h-24 w-full items-center justify-center bg-gradient-to-br from-violet-500/20 to-cyan-500/10 text-xs uppercase tracking-[0.2em] text-cyan-100">
                              video
                            </div>
                          )}
                          <div className="truncate px-2.5 py-2 text-[11px] text-slate-200">{item.name}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                <p className="mb-4 text-sm font-medium text-slate-300">AIによる検出の考え方</p>
                <ul className="space-y-3 text-sm leading-6 text-slate-200">
                  {detectedSignals.map((item) => (
                    <li key={item} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-100"
              >
                {isAnalyzing ? "分析中..." : "偏愛を分析"}
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating || !selectedObsession}
                className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-500/20"
              >
                {isGenerating ? "生成を開始中..." : "映画を生成"}
              </button>
              {message && <p role="status" className="text-sm text-cyan-100">{message}</p>}
            </div>
          </div>

          <aside className="rounded-[32px] border border-white/10 bg-slate-900/80 p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">偏愛の定義</p>
            <blockquote className="mt-4 border-l border-cyan-400/50 pl-4 text-lg leading-8 text-slate-100">
              「あなたは景色が好きなのではありません。自分だけが心の奥で繰り返し見つめている瞬間が好きなのです。」
            </blockquote>
            <div className="mt-6 rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
              このアプリは、あらかじめ決められた物語を表示するのではなく、ユーザーの写真や記録から偏愛を見つけて編集します。
            </div>
          </aside>
        </section>

        {selectedObsession && (
          <section className="mt-10 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[28px] border border-white/10 bg-slate-900/80 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-white">偏愛候補</h3>
                <span className="text-xs uppercase tracking-[0.22em] text-slate-400">
                  {uploadedMedia.length > 0 ? "検出済み" : "待機中"}
                </span>
              </div>

              <div className="space-y-3">
                {obsessions.length > 0 ? (
                  obsessions.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedObsession(item)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        selectedObsession.id === item.id
                          ? "border-cyan-400/60 bg-cyan-500/10"
                          : "border-white/10 bg-white/5 hover:border-white/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-white">{item.title}</p>
                          <p className="mt-1 text-sm text-slate-300">{item.reason}</p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-slate-800 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-300">
                          #{index + 1}
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-slate-300">
                    写真や動画をアップロードすると、AIが偏愛候補を抽出します。
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-cyan-400/15 bg-gradient-to-br from-slate-900 to-cyan-950/30 p-6">
              <div className="flex flex-wrap items-center gap-2">
                {selectedObsession ? (
                  ["偏愛", "記憶", "映画"].map((tag) => (
                    <span key={tag} className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.15em] text-cyan-100">
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.15em] text-cyan-100">
                    まだ分析前
                  </span>
                )}
              </div>

              <h3 className="mt-5 text-2xl font-semibold text-white">
                {selectedObsession.title}
              </h3>
              <p className="mt-3 text-base leading-7 text-slate-200">
                {selectedObsession.reason}
              </p>

              <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">根拠</p>
                <p className="mt-2 text-sm leading-7 text-slate-200">
                  {`${uploadedMedia.length}件のメディアと日記を根拠に、AIが抽出しています。`}
                </p>
              </div>

              <div className="mt-6">
                <p className="mb-3 text-sm font-medium text-slate-200">深掘り質問</p>
                <ul className="space-y-2">
                  {defaultQuestions.map((question) => (
                    <li key={question} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                      {question}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        <section className="mt-10 rounded-[32px] border border-white/10 bg-slate-900/80 p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">movie generation</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">最後の映画の予告編</h3>
            </div>
            <div className="rounded-full border border-pink-400/30 bg-pink-500/10 px-3 py-1 text-xs text-pink-200">
              {uploadedMedia.length > 0 ? "アップロード済み素材を使用" : "素材待機中"}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[28px] border border-white/10 bg-gradient-to-br from-[#120d1d] via-[#101827] to-[#0b1720] p-5">
              <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                <span>preview</span>
                <span>{uploadedMedia.length > 0 ? "素材あり" : "素材なし"}</span>
              </div>

              <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.25),transparent_25%),linear-gradient(135deg,_#0f172a,_#111827_40%,_#09090b)] p-6">
                <div className="aspect-video rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,_rgba(15,23,42,0.25),_rgba(2,6,23,0.9)),linear-gradient(135deg,_rgba(59,130,246,0.15),_rgba(168,85,247,0.08))] p-5">
                  <div className="flex h-full flex-col justify-end">
                    <p className="text-xs uppercase tracking-[0.25em] text-cyan-200">
                      {uploadedMedia.length > 0 ? "material-driven" : "waiting for upload"}
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {uploadedMedia.length > 0 ? "アップロードした記録から生成される予告編" : "写真と動画をアップロードすると、ここに予告編が生まれます"}
                    </p>
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/30 to-transparent p-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-cyan-200">Made in 冥途</p>
                    <p className="mt-1 text-xl font-semibold text-white">自分だけの記憶を一本の映画にする</p>
                  </div>
                  <button className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
                    再生
                  </button>
                </div>
              </div>

              <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-violet-400" />
              </div>

              {movie && (
                <div className="mt-5 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                  {movie.status === "completed"
                    ? "映画の構成を受け取りました。"
                    : movie.status === "failed"
                      ? movie.errorMessage ?? "映画の生成に失敗しました。"
                      : `映画を生成しています（${movie.status}）。`}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">章構成</p>
                <ul className="mt-4 space-y-3">
                  {(movie?.movie?.scenes ?? []).map((chapter, index) => (
                    <li key={chapter.order} className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-white">{chapter.source}</p>
                        <p className="mt-1 text-xs text-slate-300">{chapter.narration}</p>
                      </div>
                      <span className="text-xs text-slate-300">{chapter.order ?? index + 1}</span>
                    </li>
                  ))}
                  {!movie?.movie && <li className="text-sm text-slate-400">生成後に章構成が表示されます。</li>}
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">ハルシネーションのレイヤー</p>
                <div className="mt-4 flex gap-2">
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                    事実レイヤー
                  </span>
                  <span className="rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-100">
                    空想レイヤー
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-200">
                  実際の写真や動画を土台にして、本人の願望に沿う演出は「本人のための映画的な嘘」として分離して扱います。
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10 rounded-[32px] border border-white/10 bg-slate-900/80 p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">screening</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">映画を最後まで観る</h3>
            </div>
            <button className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:border-white/20">
              家族に共有
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0a0f17]">
              <div className="aspect-video bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.2),_transparent_40%),linear-gradient(135deg,_#0f172a,_#111827_45%,_#020617)] p-4">
                <div className="flex h-full items-end justify-between rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,_rgba(3,7,18,0.15),_rgba(2,6,23,0.9),_rgba(2,6,23,0.9))] p-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-cyan-200">素材ベース</p>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {uploadedMedia.length > 0 ? "アップロードした場面が再生中" : "アップロード待機中"}
                    </p>
                  </div>
                  <div className="rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs text-white backdrop-blur-sm">
                    {uploadedMedia.length > 0 ? "再生中" : "待機"}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {[
                "最初に残したい記憶",
                "のこしておきたい瞬間",
                "最後に観たい景色",
                "もう一度だけ寄りたい場所",
              ].map((chapter, index) => (
                <div key={chapter} className={`rounded-2xl border p-4 ${index === 0 ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/10 bg-white/5"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-400">chapter {index + 1}</p>
                      <p className="mt-1 text-base font-medium text-white">{chapter}</p>
                    </div>
                    <span className="text-xs text-slate-300">{index + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
