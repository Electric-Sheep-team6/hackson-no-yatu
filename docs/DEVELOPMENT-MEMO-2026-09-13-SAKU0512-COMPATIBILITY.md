# 開発メモ: saku0512側とハイブリッド動画生成側の競合

更新日: 2026-09-13
対象作業ツリー: `/Users/taku8/Desktop/hackson-no-yatu-deploy`
対象ブランチ: `perf/parallel-scene-generation`
比較先: `origin/main`

## 結論

`origin/main` の saku0512 側と、現在のハイブリッド動画生成側は重要部分で競合する。
`origin/main` をそのままマージせず、現在のハイブリッド生成を正本として、入力検証・エラー表示・
FFmpegビルド検査だけを意図的に移植する。

Git上で確認できたアカウント表記は `saku0512 <saku0512sec@gmail.com>`。
未コミット変更の作成者はGitから特定できないため、本メモでは「現在側」と記載する。

## 2026-09-12 20:30以降のsaku0512コミット

| 時刻 | コミット | 内容 |
|---|---|---|
| 20:31 | `a301236` | 映画生成の24時間3回制限を削除 |
| 20:34 | `19fa438` | AIが返した参照画像URLを入力URLだけに限定 |
| 20:41 | `8a09b84` | `ffmpeg-static`をNext.js出力トレースへ追加 |
| 20:57 | `bb6a76a` | ビルド時のFFmpeg再構築・実行可能性検査を追加 |

指定時刻の直前だが同じ判断面に関係するコミット:

| 時刻 | コミット | 内容 |
|---|---|---|
| 20:19 | `55a028e` | Gemini動画を`steps[].content[]`から取得するよう修正 |
| 20:26 | `7f3f3e2` | 動画生成の処理段階別エラー表示を追加 |

## 競合確認

現在の未コミット変更と、20:30以降のsaku0512変更が同じファイルを触る箇所:

- `frontend/__tests__/ai.test.ts`
- `frontend/__tests__/movies-route.test.ts`

`git merge-tree --write-tree HEAD origin/main` による読み取り専用の仮マージで、次の5ファイルに
コンテンツ競合が確認された:

- `frontend/__tests__/gemini-video-generator.test.ts`
- `frontend/app/api/movies/route.ts`
- `frontend/lib/ai/generateMovieScript.ts`
- `frontend/lib/ai/video/geminiVideoGenerator.ts`
- `frontend/next.config.ts`

また、現在側には上記とは別に未コミット変更がある。この状態での直接マージは、同じテストファイルを
上書きする可能性があるため行わない。

## 実装方式の差

| 項目 | saku0512側 (`origin/main`) | 現在側 |
|---|---|---|
| 構成生成 | OpenAI Responses API、reasoning medium | Gemini 3.8 Flash、thinking MEDIUM |
| 分析写真数 | 最大12枚、low detail | 最大26枚 |
| AI動画 | 3〜5シーンを逐次生成 | Gemini Omniを1回だけ生成 |
| 実写真 | AI動画の参照として使用 | 26枚をFFmpegで直接映像化 |
| 実動画 | 使用しない | 最大4本を実素材として挿入 |
| 偏愛表現 | 専用抽出なし | 頻出上位2モチーフを根拠写真番号付きで抽出 |
| AI画像 | 生成しない | 2K単体画像2枚を並列生成し、回転動画の参照に使用 |
| 合成 | AI動画をストリームコピーで連結 | パン＆ズーム、クロップ、黒画面、ASS字幕を再エンコード合成 |
| 出力尺 | シーン数・各尺により可変 | 60.5秒固定 |
| 素材比率 | ほぼAI動画 | 実記録75%＋AI25%（黒画面は編集時間として別計上） |
| 再試行 | 基本なし | 0回固定 |

## 入力検証の差

saku0512側は、AIが返した`referencePhotoUrls`を、サーバーが最初に渡した署名URLの集合と照合して
許可外URLを削除する。この考え方は任意URL取得を防ぐため有効。

現在側はAIにURLを返させず、写真番号だけを返させる。サーバー側で以下を行う:

- 写真番号の範囲検証
- 重複除去
- 欠落番号の補完
- 全26枚を一度ずつ使用
- 偏愛モチーフの根拠写真番号を検証
- 同名モチーフを拒否
- 参照画像のContent-Type、最大10MB、取得時間を検証
- 記録動画のContent-Type、最大25MB、取得時間を検証

現在の有効経路ではモデルが任意URLを作れないため、番号方式を維持する。旧`generateMovieScript`を
残す場合だけ、saku0512側のURL許可リスト処理を取り込む。

## 統合時の方針

1. `frontend/app/api/movies/generation.ts` のハイブリッド生成を正本にする。
2. `route.ts`へ旧生成ループを戻さない。ルートは認証・ジョブ作成・生成関数呼び出しに限定する。
3. 24時間3回制限は現在側に残り、saku0512側では削除済み。仕様を決めてから片方へ統一する。
4. Geminiレスポンスは`output_video`と`steps[].content[]`の両方を読める現在側を維持する。
5. saku0512側の段階別エラー表示は、秘密情報やプロバイダー本文を保存しない形で現在側へ適合させる。
6. `ffmpeg-static`方式をそのまま採用しない。現在のASS字幕にはlibassと同梱日本語フォントが必要。
7. FFmpegビルド検査を移植する場合、実行権限だけでなく`ass`フィルタとフォント読込まで検証する。

## 未検証・注意点

- saku0512側の`ffmpeg-static`でASSフィルタが利用できるかは未検証。既存テストは実行可能性だけを見る。
- 現在のハイブリッド経路はローカルLinuxで実動画生成済みだが、本番デプロイは未実施。
- 実際にアップロードされた記録動画でのE2Eは未検証。
- `origin/main`との差分は大きいため、統合時は一括マージより機能単位の手動移植が安全。

## 調査時点の検証

- 現在側: lint成功、型検査成功、68テスト成功、Next.js本番ビルド成功
- 実素材26枚: バイト重複0件、タイムライン上26件すべて一度ずつ
- 改善版成果物: `~/Desktop/last-screen-output/12_hybrid_trailer_final.mp4`
  - 60.500秒
  - 720×720
  - 24fps
  - 1452フレーム
