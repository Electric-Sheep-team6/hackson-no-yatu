"use client";

import { type FlowMessage, useMovieFlow } from "@/app/hooks/useMovieFlow";

const MESSAGE_STYLES: Record<FlowMessage["tone"], string> = {
  success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  error: "border-red-400/40 bg-red-500/10 text-red-100",
  info: "border-cyan-400/30 bg-cyan-500/10 text-cyan-100",
};

function StatusMessage({ message }: { message: FlowMessage }) {
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={`mt-4 rounded-xl border p-4 text-sm ${MESSAGE_STYLES[message.tone]}`}
    >
      {message.text}
    </p>
  );
}

export function MovieApp() {
  const flow = useMovieFlow();
  const disabled = flow.busy !== null;
  const libraryDisabled = disabled || flow.userEmail === null;

  return (
    <main className="min-h-screen bg-[#070b12] text-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="mb-8 border-b border-white/10 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">
                Made in 冥途
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                人生の最後に観る映画を、人生をかけて作る。
              </h1>
            </div>

            {flow.userEmail ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
                  {flow.userEmail}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={flow.signOut}
                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:border-white/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {flow.busy === "auth" ? "処理中..." : "ログアウト"}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label="メールアドレス"
                  value={flow.email}
                  onChange={(event) => flow.setEmail(event.target.value)}
                  type="email"
                  placeholder="メールアドレス"
                  className="rounded-full border border-white/15 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-cyan-400/60"
                />
                <input
                  aria-label="パスワード"
                  value={flow.password}
                  onChange={(event) => flow.setPassword(event.target.value)}
                  type="password"
                  placeholder="パスワード"
                  className="rounded-full border border-white/15 bg-slate-950 px-3 py-2 text-sm outline-none transition focus:border-cyan-400/60"
                />
                <button
                  type="button"
                  disabled={disabled || !flow.email || !flow.password}
                  onClick={() => flow.authenticate("signIn")}
                  className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {flow.busy === "auth" ? "処理中..." : "ログイン"}
                </button>
                <button
                  type="button"
                  disabled={disabled || !flow.email || !flow.password}
                  onClick={() => flow.authenticate("signUp")}
                  className="px-2 text-sm text-cyan-200 underline transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  新規登録
                </button>
              </div>
            )}
          </div>

          {flow.pendingConfirmationEmail && !flow.userEmail && (
            <div
              role="status"
              className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-sm text-amber-50"
            >
              <p className="font-semibold text-amber-100">
                メールアドレスの確認が必要です
              </p>
              <p className="mt-2 leading-6">
                <span className="font-semibold">
                  {flow.pendingConfirmationEmail}
                </span>{" "}
                宛に確認メールを送信しました。
              </p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 leading-6 text-amber-50/90">
                <li>受信した確認メールを開いてください。</li>
                <li>メール内の確認リンクを開いてください。</li>
                <li>確認が完了したら、この画面からログインしてください。</li>
              </ol>
              <p className="mt-3 text-xs leading-5 text-amber-100/70">
                メールが見つからない場合は、迷惑メールフォルダも確認してください。
                Supabaseの組み込みメール送信には1時間あたり2通までの制限があるため、
                短時間に何度も新規登録を繰り返さないでください。
              </p>
            </div>
          )}

          {flow.message?.area === "auth" && (
            <StatusMessage message={flow.message} />
          )}
        </header>

        <section className="rounded-[32px] border border-white/10 bg-slate-900 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">
            1. library
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            日記と写真を、何度でも貯める
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            保存済みの全日記・全写真が、次の偏愛分析と映画生成の素材になります。
          </p>

          {!flow.userEmail && (
            <div
              role="status"
              className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100"
            >
              日記や写真を保存するには、先にログインしてください。
            </div>
          )}

          {flow.message?.area === "library" && (
            <StatusMessage message={flow.message} />
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <label htmlFor="diary" className="mb-2 block text-sm font-medium">
                新しい日記
              </label>
              <textarea
                id="diary"
                value={flow.diaryDraft}
                onChange={(event) => flow.setDiaryDraft(event.target.value)}
                disabled={libraryDisabled}
                rows={6}
                placeholder={
                  flow.userEmail
                    ? "今日残したい記憶を書いてください"
                    : "ログインすると日記を追加できます"
                }
                className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={flow.saveDiary}
                disabled={libraryDisabled || !flow.diaryDraft.trim()}
                className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {flow.busy === "diary" ? "保存中..." : "日記を追加"}
              </button>

              <div className="mt-4 space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-400">
                  保存済みの日記 {flow.diaries.length}件
                </p>
                {flow.diaries.length ? (
                  flow.diaries.map((diary) => (
                    <article
                      key={diary.id}
                      className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200"
                    >
                      <p className="line-clamp-3">{diary.content}</p>
                      <time className="mt-2 block text-xs text-slate-500">
                        {new Date(diary.createdAt).toLocaleDateString("ja-JP")}
                      </time>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">まだ日記がありません。</p>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">写真ライブラリ</p>
              <label
                className={`flex items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center text-sm transition ${
                  libraryDisabled
                    ? "cursor-not-allowed border-white/10 bg-white/5 text-slate-500 opacity-60"
                    : "cursor-pointer border-cyan-400/40 bg-cyan-500/5 text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-500/10"
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={libraryDisabled}
                  className="hidden"
                  onChange={flow.uploadPhotos}
                />
                {flow.busy === "upload"
                  ? "写真をアップロードしています..."
                  : flow.userEmail
                    ? "複数の写真を選択して追加"
                    : "ログインすると写真を追加できます"}
              </label>

              {flow.busy === "upload" && flow.uploadProgress && (
                <div className="mt-3 rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3">
                  <p role="status" className="text-sm font-medium text-cyan-100">
                    {flow.uploadProgress.total}枚中
                    {flow.uploadProgress.current}枚目をアップロード中...
                  </p>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full bg-cyan-400 transition-[width] duration-300"
                      style={{
                        width: `${(flow.uploadProgress.current / flow.uploadProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <p className="mt-3 text-sm text-slate-300">
                保存済み: {flow.photoCount}枚
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {flow.newPhotos.map((photo) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={photo.id}
                    src={photo.previewUrl}
                    alt={photo.name}
                    className="h-24 w-full rounded-xl object-cover"
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-[32px] border border-white/10 bg-slate-900 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-violet-300">
            2. obsession analysis
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            蓄積した記録から、偏愛を見つける
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            対象: 日記 {flow.diaries.length}件・写真 {flow.photoCount}枚
          </p>
          <button
            type="button"
            onClick={flow.analyze}
            disabled={
              disabled ||
              !flow.userEmail ||
              flow.diaries.length + flow.photoCount === 0
            }
            className="mt-5 rounded-full bg-violet-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {flow.busy === "analysis" ? "分析中..." : "偏愛を分析"}
          </button>

          {flow.message?.area === "analysis" && (
            <StatusMessage message={flow.message} />
          )}

          {flow.obsession && (
            <article className="mt-5 rounded-2xl border border-violet-400/30 bg-violet-500/10 p-5">
              <p className="text-xs text-violet-200">検出された偏愛</p>
              <h3 className="mt-2 text-xl font-semibold">
                {flow.obsession.title}
              </h3>
              <p className="mt-2 leading-7 text-slate-200">
                {flow.obsession.reason}
              </p>
            </article>
          )}
        </section>

        <section className="mt-8 rounded-[32px] border border-white/10 bg-slate-900 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-pink-300">
            3. movie generation
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            偏愛を、一本の映画にする
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            偏愛分析後に、脚本・シーン生成・結合を順番に実行します。
          </p>
          <button
            type="button"
            onClick={flow.generate}
            disabled={disabled || !flow.userEmail || !flow.obsession}
            className="mt-5 rounded-full bg-pink-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {flow.busy === "movie" ? "映画を生成中..." : "映画を生成"}
          </button>

          {flow.message?.area === "movie" && (
            <StatusMessage message={flow.message} />
          )}

          {flow.movie?.videoUrl ? (
            <video
              controls
              preload="metadata"
              className="mt-6 aspect-video w-full rounded-2xl bg-black"
              src={flow.movie.videoUrl}
            >
              生成した映画
            </video>
          ) : (
            <div className="mt-6 flex aspect-video items-center justify-center rounded-2xl border border-white/10 bg-slate-950 text-sm text-slate-400">
              {flow.movie
                ? flow.movie.status === "failed"
                  ? flow.movie.errorMessage ?? "動画生成に失敗しました。"
                  : `生成状態: ${flow.movie.status}`
                : "映画を生成すると、ここで再生できます。"}
            </div>
          )}

          {flow.movie?.movie?.scenes && (
            <ol className="mt-5 grid gap-2 sm:grid-cols-3">
              {flow.movie.movie.scenes.map((scene) => (
                <li
                  key={scene.order}
                  className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm"
                >
                  <span className="text-pink-200">{scene.order}. </span>
                  {scene.source}
                  <p className="mt-1 text-xs text-slate-300">
                    {scene.narration}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
