"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";

type MediaItem = {
  id: string;
  name: string;
  type: "image" | "video";
  previewUrl?: string;
};

type CompletedMovie = {
  id: string;
  videoUrl: string;
  title?: string;
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
  const [uploadedMedia, setUploadedMedia] = useState<MediaItem[]>([]);
  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [completedMovie, setCompletedMovie] = useState<CompletedMovie | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadCompletedMovie = async () => {
      const moviesResponse = await fetch("/api/movies");
      if (!moviesResponse.ok) return;
      const { items } = await moviesResponse.json() as { items: { id: string; status: string }[] };
      const completed = items.find((item) => item.status === "completed");
      if (!completed) return;
      const movieResponse = await fetch(`/api/movies/${completed.id}`);
      if (!movieResponse.ok) return;
      const movie = await movieResponse.json() as { id: string; videoUrl: string | null; movie: { title?: string } | null };
      if (!cancelled && movie.videoUrl) setCompletedMovie({ id: movie.id, videoUrl: movie.videoUrl, title: movie.movie?.title });
    };
    void loadCompletedMovie().catch(() => {
      // 未ログインや一時的な通信失敗時は、待機表示を維持する。
    });
    return () => { cancelled = true; };
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextMedia: MediaItem[] = Array.from(event.target.files ?? []).map((file) => {
      const isVideo = file.type.startsWith("video");

      return {
        id: crypto.randomUUID(),
        name: file.name,
        type: isVideo ? "video" : "image",
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

  const obsessionCandidates = useMemo(() => {
    if (uploadedMedia.length === 0) {
      return [];
    }

    const imageCount = uploadedMedia.filter((item) => item.type === "image").length;
    const videoCount = uploadedMedia.filter((item) => item.type === "video").length;

    return [
      {
        title: "繰り返し映る場面",
        subtitle: `${uploadedMedia.length}件の記録の中で反復率が高い場所と時間帯`,
        reason:
          "同じ場所や同じ時間帯のメディアが複数存在しているため、本人がその景色に最も強く惹かれている可能性が高いです。",
        tags: ["場所", "時間", "光"],
      },
      {
        title: "繰り返し登場する人物",
        subtitle: `${imageCount}枚の写真に、同じ人物や顔が含まれている可能性が高い`,
        reason:
          "写真の中で同じ人物が何度も現れている場合、その人が記憶の中心にあると判断できます。",
        tags: ["人物", "記憶", "家族"],
      },
      {
        title: "音と帰路の感覚",
        subtitle: `${videoCount}件の動画で、移動や帰宅の感覚が強く残っている`,
        reason:
          "動画と音声の記録は、ただの景色ではなく、本人が帰路や音に対して強い執着を持っていることを示します。",
        tags: ["音", "帰路", "動線"],
      },
    ];
  }, [uploadedMedia]);

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
          <button className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-500/20">
            予告編を視聴
          </button>
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
                onClick={() => setIsAnalyzed(true)}
                className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-100"
              >
                偏愛を分析
              </button>
              <button
                type="button"
                onClick={() => setIsGenerating(true)}
                className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-500/20"
              >
                映画を生成
              </button>
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

        {isAnalyzed && (
          <section className="mt-10 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[28px] border border-white/10 bg-slate-900/80 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-white">偏愛候補</h3>
                <span className="text-xs uppercase tracking-[0.22em] text-slate-400">
                  {uploadedMedia.length > 0 ? "検出済み" : "待機中"}
                </span>
              </div>

              <div className="space-y-3">
                {obsessionCandidates.length > 0 ? (
                  obsessionCandidates.map((item, index) => (
                    <button
                      key={item.title}
                      type="button"
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        index === 0
                          ? "border-cyan-400/60 bg-cyan-500/10"
                          : "border-white/10 bg-white/5 hover:border-white/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-white">{item.title}</p>
                          <p className="mt-1 text-sm text-slate-300">{item.subtitle}</p>
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
                {obsessionCandidates.length > 0 ? (
                  obsessionCandidates[0].tags.map((tag) => (
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
                {obsessionCandidates.length > 0 ? obsessionCandidates[0].title : "アップロードが解析対象です"}
              </h3>
              <p className="mt-3 text-base leading-7 text-slate-200">
                {obsessionCandidates.length > 0
                  ? obsessionCandidates[0].reason
                  : "写真・動画・日記を読み解くことで、誰にも気づかれないほど細かい執着を抽出します。"}
              </p>

              <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">根拠</p>
                <p className="mt-2 text-sm leading-7 text-slate-200">
                  {obsessionCandidates.length > 0
                    ? `${uploadedMedia.length}件のメディアから、反復が確認できる記録を根拠として抽出しています。`
                    : "アップロードした実データが、分析の根拠になります。ここに書かれた説明は仮の導線です。"}
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

              {isGenerating && (
                <div className="mt-5 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                  AIがアップロードした素材から、章構成と予告編を生成しています。
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">章構成</p>
                <ul className="mt-4 space-y-3">
                  {[
                    "最初に強く残った場面",
                    "繰り返される人物と気持ち",
                    "最後に見たい時間帯",
                    "再度訪れたい場所",
                  ].map((chapter, index) => (
                    <li key={chapter} className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-white">{chapter}</p>
                      </div>
                      <span className="text-xs text-slate-300">{index + 1}</span>
                    </li>
                  ))}
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
              {completedMovie ? (
                <video controls preload="metadata" className="aspect-video w-full bg-black" src={completedMovie.videoUrl}>
                  {completedMovie.title ?? "生成した映画"}
                </video>
              ) : (
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
              )}
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
