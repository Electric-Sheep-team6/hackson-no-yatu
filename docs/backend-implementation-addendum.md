# LAST SCREEN バックエンド実装補足仕様 v1.0

- 作成: Claude Code(江藤拓海氏の依頼により、既存仕様の実装ギャップを埋めるために作成)
- 作成日: 2026-09-10
- 位置づけ: `docs/backend-spec.md`(v1.2, 江藤拓海作成)と`docs/ai-architecture.md`を**正とし、変更しない**。本ドキュメントはその2つに対する**追加**であり、実装に着手する時点でまだ決まっていなかった詳細(リクエスト/レスポンスの具体的なJSON形状、エラー形式、環境変数、ディレクトリ構成、AI未実装時のスタブ方針)を埋めるものである。既存仕様と矛盾する記述があれば既存仕様を優先する。

## 0. 調査で確認した前提(この補足を書いた理由)

- リポジトリ`Electric-Sheep-team6/hackson-no-yatu`には現時点で`frontend/`(Next.js scaffold)と`docs/`しかなく、バックエンド実装(`frontend/app/api/**`, `lib/`, `middleware.ts`, Supabaseマイグレーション)は**まだ1行も存在しない**。`docs/backend-spec.md`は設計であり実装ではない。
- `frontend/app/page.tsx`は現状すべてクライアント側のダミー状態(`useState`)で完結しており、`fetch`によるAPI呼び出しは一切ない。ログイン/サインアップ画面も存在しない。したがって`docs/backend-spec.md` 3章のAuth設計(Cookieセッション)に対応するUIはまだ無い。
- Teams「デプロイ先」チャンネルにあるURL(`backend-k34f.onrender.com`, `*.pages.dev`)は旧スタック(Go + SvelteKit)のもので、現行のNext.js+Supabase構成には**無関係**。新しいデプロイ先(Vercel URL等)はチーム内にまだ共有されていない。
- Teams「github通知」チャンネルでは旧`godot`リポジトリが8/30に削除された記録のみで、現行リポジトリの通知連携は無い。
- 以上より、「フロントとバックエンドの結線」自体もまだ着手されていない作業であり、本補足はバックエンドを**フロントの現状のUIから独立して単体で動作・検証できる形**で実装することを優先する(理由: フロント側`page.tsx`の書き換えは今回のスコープ外とし、江藤氏本人か担当者の判断を待つ)。

## 1. 本実装の範囲

含む:
- `docs/backend-spec.md` 2〜7章の実装(DBマイグレーション、Auth連携ヘルパー、Storage RLS、API Route Handlers、非同期ステータス遷移)
- `docs/ai-architecture.md`の契約①②③に準拠したAI連携ポイントの**モック実装**(佐藤佑作氏が本実装に差し替えられるよう、同じ関数シグネチャ/ファイルパスで固定のダミー値を返すスタブを置く。実際のOpenAI/Gemini呼び出しは行わない)
- 上記を検証するための最小限のリクエスト例・手動テスト手順

含まない(スコープ外、担当外):
- `frontend/app/page.tsx`等、既存フロントエンドUIの書き換え・API結線
- OpenAI/Gemini/FFmpegの実接続(佐藤佑作氏の担当、契約の型は変更しない)
- 認証UI(ログイン/サインアップ画面)の新規作成
- Supabaseプロジェクト自体の新規作成(既存プロジェクトがあればその接続情報を`.env.local`に設定する運用とし、無ければ別途チームに確認する)

## 2. ディレクトリ構成(新規追加ファイルのみ)

```
frontend/
  middleware.ts                          # 3.2節のセッションリフレッシュ
  lib/
    supabase/
      server.ts                          # createServerClient ラッパー
      client.ts                          # createBrowserClient ラッパー(将来のフロント結線用)
      admin.ts                           # service_role クライアント(movies書き込み用)
    ai/
      analyzeObsession.ts                # 契約①のモック実装
      generateMovieScript.ts             # 契約②のモック実装
      video/
        VideoGenerator.ts                # 契約③のインターフェース定義
        mockVideoGenerator.ts            # 契約③のモック実装
    apiError.ts                          # 4章のエラー形式ヘルパー
    validation.ts                        # zodスキーマ集
  app/
    api/
      diaries/route.ts                   # POST, GET
      photos/route.ts                    # POST
      obsessions/route.ts                # POST, GET
      movies/route.ts                    # POST, GET
      movies/[id]/route.ts               # GET
supabase/
  migrations/
    0001_init.sql                        # docs/backend-spec.md 2章のDDL + 3.3のトリガー + 4.4のRLS
docs/
  backend-implementation-addendum.md     # 本ファイル
```

## 3. 環境変数(`.env.local.example`を新規追加する)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# 以下はAI担当が本実装に差し替える際に使用する想定。モック実装では未使用。
OPENAI_API_KEY=
GEMINI_API_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY`はサーバー専用(`NEXT_PUBLIC_`を付けない)。実際の値はチームのSupabaseダッシュボードから取得し、`.env.local`(gitignore対象、コミットしない)に設定する。値が無い場合はビルド・起動時にエラーで気づけるようにする(起動時バリデーション)。

## 4. 共通エラーレスポンス形式(`docs/backend-spec.md`に規定が無いため補足)

全APIルートで統一する:

```ts
type ApiErrorBody = { error: string; message: string };
```

| 状況 | status | error |
|---|---|---|
| 未ログイン | 401 | `unauthorized` |
| 入力バリデーション失敗 | 400 | `invalid_request` |
| 自分以外のリソースへのアクセス | 403 | `forbidden` |
| 対象が存在しない | 404 | `not_found` |
| サーバー内部エラー | 500 | `internal_error` |

## 5. 各エンドポイントの具体的な入出力(`docs/backend-spec.md` 5章の表を具体化)

### `POST /api/diaries`
- body: `{ content: string }`(`content`は1〜10000文字、zodで検証)
- 201: `{ id: string; content: string; createdAt: string }`

### `GET /api/diaries`
- 200: `{ items: { id: string; content: string; createdAt: string }[] }`(自分のuser_idのみ、`created_at desc`)

### `POST /api/photos`
- body: `{ storagePath: string; diaryId?: string | null }`
- `storagePath`の先頭セグメント(`storage.foldername`相当、`/`区切りの1つ目)がログインユーザーの`user_id`と一致しない場合は403
- `diaryId`を指定する場合、そのdiaryが自分のものか確認し、一致しなければ403
- 201: `{ id: string; storagePath: string; diaryId: string | null; createdAt: string }`

### `POST /api/obsessions`
- body 無し(自分の蓄積済み日記・写真を全件使う、MVP範囲)
- 処理: 自分の`diaries.content`配列と、`photos`から署名付きURL配列(`createSignedUrl`, 有効期限1時間)を作り、`lib/ai/analyzeObsession.ts`(契約①、現時点ではモック)に渡す → 戻り値をそのまま`obsessions.analysis_json`へ保存
- 201: `{ id: string; title: string; reason: string; createdAt: string }`
- 日記・写真が1件も無い場合は400 `invalid_request`(「先に日記か写真を追加してください」)

### `GET /api/obsessions`
- 200: `{ items: { id: string; title: string; reason: string; createdAt: string }[] }`

### `POST /api/movies`
- body: `{ obsessionId: string }`
- `obsessionId`が自分のものか確認(無ければ404、他人のものなら403)
- `movies`行を`status='pending'`で作成し、201を即時返す: `{ id: string; status: 'pending' }`
- 生成処理(analyzing→generating→processing→completed/failed)は**同一リクエスト内であっても`await`完了を待たずレスポンスを返してよい**(Next.jsのRoute Handler内でPromiseをawaitせず発火するだけの簡易実装で可。ハッカソン規模でキュー基盤を導入するのは過剰と判断)。処理完了時に`movies`行を`update`する。

### `GET /api/movies/:id`
- 自分のものでなければ404
- 200: `{ id: string; status: string; videoPath: string | null; errorMessage: string | null; movie: MovieScript | null }`
  - `videoPath`が入っている場合、フロント側で署名付きURLに変換する想定(バックエンドはpathのみ返す。既存仕様4.3のパターンを踏襲)

### `GET /api/movies`
- 200: `{ items: { id: string; status: string; obsessionId: string; createdAt: string }[] }`

## 6. AIモック実装の方針(佐藤佑作氏が差し替える前提)

`docs/ai-architecture.md`の型定義(`ObsessionAnalysis`, `MovieScript`, `VideoGenerator`)をそのまま`lib/ai/`配下に置き、関数の中身だけ固定値を返すようにする。例:

```ts
// lib/ai/analyzeObsession.ts
export async function analyzeObsession(input: AnalyzeObsessionInput): Promise<ObsessionAnalysis> {
  // TODO(佐藤佑作): OpenAI Responses API (gpt-5.6-terra) に差し替える。
  // 関数シグネチャ・戻り値の型は docs/ai-architecture.md 3.1 節を変更しないこと。
  return {
    title: "モック偏愛",
    reason: "AI未接続のため仮の値です",
    keywords: [],
    emotion: [],
    evidence: [],
    visualMotifs: [],
  };
}
```

`generateMovieScript`・`VideoGenerator.generateScene`も同様に、型はそのまま・中身だけ固定値/ダミーmp4パスを返す。これにより、AI担当の実装が間に合っていない状態でも一連のAPI(`obsessions`→`movies`→ポーリング完了)が最後まで動作し、フロント結線やデモのリハーサルを先に進められる。佐藤氏が実装を差し替える際は、このファイルの中身だけを書き換えればよく、Route Handler側の変更は不要になるよう設計する。

## 7. マイグレーションの適用方法

`docs/backend-spec.md` 2章・3.3節・4.4節のSQLをそのまま`supabase/migrations/0001_init.sql`にまとめる(内容は変更しない、ファイルへの転記のみ)。適用はSupabase CLI(`supabase db push`)またはダッシュボードのSQL Editorから実行する。既存のSupabaseプロジェクトが無い場合はチームに確認する(0章に記載の未確認事項)。

## 8. 動作確認の最小手順(自動テストとは別に、実装後に人が確認する手順)

```
1. npm run dev で起動
2. Supabase Authで1ユーザーをサインアップ(または既存ユーザーでログイン)
3. POST /api/diaries → 201になることを確認
4. POST /api/obsessions → 201、AIモックの固定値が返ることを確認
5. POST /api/movies { obsessionId } → 201, status=pending
6. GET /api/movies/:id をポーリング → 最終的にstatus=completedになることを確認
7. 未ログイン状態で同じAPIを叩き、401が返ることを確認
```

## 9. 未確定事項(江藤拓海氏に確認が必要)

- Supabaseプロジェクトが既に作成済みか、接続情報(URL/anon key/service role key)をどこから取得すればよいか
- フロントエンド(`page.tsx`)への結線(fetch呼び出し・ログイン画面の追加)は誰がいつ着手するか。本実装はバックエンド単体で検証可能な状態までとし、結線は別タスクとする
- 佐藤佑作氏のAI実装がいつ`lib/ai/`のモックを置き換える見込みか
