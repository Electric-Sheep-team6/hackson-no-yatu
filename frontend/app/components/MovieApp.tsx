"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMovieFlow } from "@/app/hooks/useMovieFlow";
import { createClient } from "@/lib/supabase/client";

export function MovieApp({ userEmail }: { userEmail: string }) {
  const flow = useMovieFlow();
  const router = useRouter();
  const disabled = flow.busy !== null;
  const [signingOut, setSigningOut] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setAuthError(null);

    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      router.replace("/login");
      router.refresh();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "ログアウトに失敗しました。");
      setSigningOut(false);
    }
  };

  return (
    <main className="last-screen-shell">
      <div className="sky-orb sky-orb-left" aria-hidden="true" />
      <div className="sky-orb sky-orb-right" aria-hidden="true" />

      <header className="site-header">
        <a className="brand-mark" href="#top" aria-label="Made in 冥途 ホーム">
          <span>Made in 冥途</span>
          <small>たきささえ</small>
        </a>

        <div className="user-session">
          <div><span>ログイン中</span><p>{userEmail}</p></div>
          <button type="button" className="text-button" disabled={signingOut || disabled} onClick={() => void signOut()}>{signingOut ? "ログアウト中..." : "ログアウト"}</button>
          {authError && <p role="alert" className="session-error">{authError}</p>}
        </div>
      </header>

      <div id="top" className="page-frame">
        <section className="hero" aria-labelledby="hero-title">
          <p className="hero-kicker">100歳のわたしへ贈る</p>
          <h1 id="hero-title">人生の<br />最終上映</h1>
          <p className="hero-lead">日々の記録から、あなたが愛した時間を見つける。<br />それを、一本の映画として未来へ届けます。</p>
          <div className="stairway" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
        </section>

        <div className="journey-intro">
          <p>YOUR LIFE, ONE LAST SCREENING</p>
          <span>記録する</span><span>見つける</span><span>映画にする</span>
        </div>

        <section className="process-section" aria-labelledby="library-title">
          <div className="section-heading">
            <p className="step-number">01</p>
            <div><p className="eyebrow">MEMORY LIBRARY</p><h2 id="library-title">あなたの日々を、残していく</h2><p>日記・写真・動画は、未来のあなたへ贈る映画の素材になります。</p></div>
          </div>

          <div className="library-layout">
            <div className="diary-column">
              <label htmlFor="diary" className="field-label">今日の記憶</label>
              <textarea id="diary" value={flow.diaryDraft} onChange={(event) => flow.setDiaryDraft(event.target.value)} rows={6} placeholder="今日、心に残ったことを書いてください。" />
              <button type="button" onClick={flow.saveDiary} disabled={disabled || !flow.diaryDraft.trim()} className="button">{flow.busy === "diary" ? "保存中..." : "日記を残す"}</button>

              <div className="saved-diaries">
                <p className="list-caption">保存した日記　{flow.diaries.length}件</p>
                {flow.diaries.length ? flow.diaries.map((diary) => (
                  <article key={diary.id} className="diary-entry"><p>{diary.content}</p><time>{new Date(diary.createdAt).toLocaleDateString("ja-JP")}</time></article>
                )) : <p className="empty-copy">最初の記憶を残してみましょう。</p>}
              </div>
            </div>

            <div className="media-column">
              <p className="field-label">写真と動画</p>
              <div className="upload-row">
                <label className="upload-control"><input type="file" accept="image/*" multiple onChange={flow.uploadPhotos} /><span className="upload-symbol" aria-hidden="true">＋</span><span>写真を追加</span><small>思い出の一枚を選ぶ</small></label>
                <label className="upload-control"><input type="file" accept="video/*" multiple onChange={flow.uploadVideos} /><span className="upload-symbol" aria-hidden="true">＋</span><span>動画を追加</span><small>25MB以下・最大4本</small></label>
              </div>
              <p className="media-count">写真 <strong>{flow.photoCount}</strong>枚<span aria-hidden="true">／</span>動画 <strong>{flow.videoCount}</strong>本</p>
              <p className="support-copy">映画には直近の写真26枚と動画4本までを使います。</p>
              {flow.newPhotos.length > 0 && <div className="photo-strip">{flow.newPhotos.map((photo) => <Image key={photo.id} src={photo.previewUrl} alt={photo.name} width={240} height={180} unoptimized />)}</div>}
            </div>
          </div>
        </section>

        <section className="process-section analysis-section" aria-labelledby="analysis-title">
          <div className="section-heading">
            <p className="step-number">02</p>
            <div><p className="eyebrow">FIND YOUR STORY</p><h2 id="analysis-title">記録の中から、偏愛を見つける</h2><p>何度も選んだ景色や言葉から、あなたらしさの核を読み取ります。</p></div>
          </div>
          <div className="action-line">
            <p>日記 {flow.diaries.length}件　写真 {flow.photoCount}枚　動画 {flow.videoCount}本</p>
            <button type="button" onClick={flow.analyze} disabled={disabled || flow.diaries.length + flow.photoCount === 0} className="button button-wide">{flow.busy === "analysis" ? "分析中..." : "わたしの偏愛を見つける"}</button>
          </div>
          {flow.obsession && <article className="obsession-result"><p className="eyebrow">YOUR OBSESSION</p><h3>{flow.obsession.title}</h3><p>{flow.obsession.reason}</p></article>}
        </section>

        <section className="process-section screening-section" aria-labelledby="movie-title">
          <div className="section-heading">
            <p className="step-number">03</p>
            <div><p className="eyebrow">LAST SCREENING</p><h2 id="movie-title">偏愛を、一本の映画にする</h2><p>実際の記録を中心に、AIの象徴映像を織り交ぜた約56秒の予告編です。</p></div>
          </div>
          <button type="button" onClick={flow.generate} disabled={disabled || !flow.obsession || flow.photoCount === 0} className="button premiere-button">{flow.busy === "movie" ? "映画を編集中..." : "人生の映画をつくる"}</button>
          <div className="screen-frame">
            {flow.movie?.videoUrl ? <video controls preload="metadata" src={flow.movie.videoUrl}>生成した映画</video> : <div className="empty-screen"><span>MADE IN MEIDO</span><p>{flow.movie?.status === "failed" ? flow.movie.errorMessage ?? "映画生成に失敗しました。" : flow.movie ? `生成状態: ${flow.movie.status}` : "あなたの映画は、ここで上映されます。"}</p></div>}
          </div>
        </section>

        {flow.message && <p role="status" className="status-message">{flow.message}</p>}
        <footer><p>衰えを受け入れた上で、これまで生きてきた世界と、もう一度ポジティブに関わる。</p><span>Made in 冥途</span></footer>
      </div>
    </main>
  );
}
