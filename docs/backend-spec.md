# LAST SCREEN バックエンド仕様 v1.2

- 作成: 江藤拓海(役割B: Supabase/バックエンド担当) / チーム たきささえ / Electric Sheep 2026「LAST SCREEN」
- 作成日: 2026-09-03 / 更新: 2026-09-06(AIモデル・入出力契約を確定)
- スコープ: DB設計 + Auth設計 + Storage設計 + バックエンドAPI設計
- 前提: Web版(Next.js + Vercel + Supabase)

## 0. この仕様の前提(チームで確認済みの判断)

1. **技術スタック** — Web版(Next.js + Vercel + Supabase)。チーム全体合意済み。
2. **AI連携** — 偏愛分析・映画構成生成・動画生成はAI担当(佐藤佑作)が実装。バックエンドは接続点(インターフェース)と非同期処理の状態管理を用意する。
3. **AIモデル選定** — 偏愛分析・映画構成生成はOpenAI Responses APIの`gpt-5.6-terra`、動画生成はGemini APIの`gemini-omni-1.1-flash`をMVPで採用する。ただしバックエンドはprovider/modelを直接参照せず、モデル非依存に作る。詳細と料金は[AI設計・モデル選定](./ai-architecture.md)を参照する。
4. **DBスキーマ** — ChatGPT叩き台(users/diaries/photos/obsessions/movies)をそのまま採用して着手。
5. **非同期処理** — ポーリング方式。
6. **個人情報** — プロトタイプ完成優先。同意取得・削除フローは対象外(今回のスコープ外)。
7. **スコープ** — 9/3中に完了させるのはDB設計とバックエンド設計の部分のみ。AI・フロント結線は別担当・別スケジュール。

AIモデルの具体的選定は確定済み。残る論点は末尾の「8. 残る未確定事項」を参照。

## 1. 全体構成

ChatGPT叩き台の構成をそのまま踏襲。バックエンドの責務は「データの出し入れ」と「AI呼び出しの取次ぎ」に限定し、分析・生成の中身には立ち入らない。

```
ブラウザ(Next.js UI)
  │
  ▼
Next.js API Routes ── ここが本仕様のスコープ
  │        │
  │        └─▶ Supabase(Auth / Postgres / Storage)
  │
  └─▶ AI連携ポイント(6章) ── 佐藤佑作(AI担当)が中身を実装
           │
           ▼
      Gemini動画生成 → FFmpeg統合 → Supabase Storage → Web再生
```

## 2. DBスキーマ

叩き台の5テーブルを、型・主キー・外部キーまで実装可能な形に落とし込んだもの。フィールド構成自体は変更していない。`updated_at`・`failed`ステータス・外部キー制約は、叩き台にはなかった実装上必須の補完(理由は表の下に明記)。

```sql
-- Supabase Auth の auth.users を拡張するプロフィールテーブル
create table users (
  id          uuid primary key references auth.users(id),
  display_name text,
  created_at  timestamptz not null default now()
);

create table diaries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);

create table photos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  diary_id      uuid references diaries(id) on delete set null, -- 日記に紐付かない単体アップロードも許容
  storage_path  text not null,      -- Supabase Storage 上のパス
  created_at    timestamptz not null default now()
);

create table obsessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  title         text not null,       -- 例: "夜の電車"
  reason        text,                -- AIが導き出した根拠の要約
  analysis_json jsonb not null,      -- 6章 契約①の出力そのまま
  created_at    timestamptz not null default now()
);

create table movies (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  obsession_id   uuid not null references obsessions(id) on delete cascade,
  status         text not null default 'pending'
                 check (status in ('pending','analyzing','generating','processing','completed','failed')),
  movie_json     jsonb,             -- 6章 契約②の出力(章構成・シーン台本)
  video_path     text,              -- 完成後の Supabase Storage パス
  error_message  text,              -- failed 時の原因(補完項目)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

補完した点: `error_message`と`status='failed'`(生成失敗時にポーリング側が無限待ちにならないよう必須)、`updated_at`(ステータス変化の追跡)、各テーブルの外部キー制約(整合性維持)。DB担当としてこの3点を追加した。

## 3. Auth設計

方式: **メール/パスワード認証のみ**(OAuth対象外)。フロント⇄バックエンドの認証情報の受け渡しは**Cookieベースセッション**(`@supabase/ssr`)。

### 3.1 サインアップ/ログインの流れ

フロントはSupabaseのブラウザクライアント(`createBrowserClient`、`@supabase/ssr`)から`supabase.auth.signUp({email, password})` / `signInWithPassword({email, password})`を直接呼ぶ。Supabase Auth自体が認証エンドポイントを提供するため、サインアップ/ログイン専用のNext.js API Routeは不要。ログイン成功時、`@supabase/ssr`がセッションをCookieに自動保存し、以降のリクエストはこのCookieに乗る。

サーバー側(Route Handlers)は`createServerClient`(`@supabase/ssr`)でCookieからセッションを読み、`supabase.auth.getUser()`でログインユーザーを取得する。

```ts
// 各API Routeでの認可チェック(共通パターン)
const supabase = createServerClient(/* cookies経由 */)
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
```

### 3.2 セッションのリフレッシュ(実装必須)

`middleware.ts`を用意し、全リクエストでセッショントークンのリフレッシュを行う(Supabase公式のNext.js App Router向けパターン)。これがないとセッションが途中で切れる。

```ts
// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  await supabase.auth.getUser() // トークンが古ければここでリフレッシュされる
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

### 3.3 `users`テーブルとの同期

`auth.users`に新規登録されたら、DBトリガーで自動的に`public.users`に行を作る(アプリコード側では作らない — 実装漏れによる不整合を防ぐため)。

```sql
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### 3.4 メール確認(プロトタイプ向けの割り切り)

Supabaseダッシュボードで「Confirm email」設定を**無効化**する(登録直後にログイン可能にする)。SMTP設定・確認メール導線はハッカソン規模では工数対効果が見合わないための割り切り。

## 4. Storage設計

方式: **フロントからSupabase Storageへ直接アップロード**、バケットは**private**、配信は**署名付きURL**。

### 4.1 バケット構成

| バケット名 | 用途 | 書き込み元 | 公開設定 |
|---|---|---|---|
| `photos` | ユーザーがアップロードする日記の写真 | フロント(クライアント直アップロード) | private |
| `movies` | 完成した映画ファイル(mp4) | バックエンド/動画統合(D担当、`service_role`鍵経由) | private |

`movies`バケットはAI/動画統合パイプライン(C・D担当)がサーバー側で書き込む想定のため、クライアント直アップロードの対象外。役割Bとしてのスコープは、この2バケットの「箱」とRLSポリシーを用意するところまで。

### 4.2 パス命名規則

```
photos/{user_id}/{uuid}.{ext}
movies/{user_id}/{movie_id}.mp4
```

`user_id`を必ずパスの先頭に置く。これがそのままRLSポリシーの判定キーになる。

### 4.3 アップロードの流れ(写真)

1. フロントはログイン済みのSupabaseブラウザクライアントで直接アップロードする:
   ```ts
   const path = `${userId}/${crypto.randomUUID()}.${ext}`
   await supabase.storage.from('photos').upload(path, file)
   ```
2. アップロード成功後、フロントは`POST /api/photos`に`{storage_path: path, diary_id}`を送り、`photos`テーブルへメタデータを記録する。バックエンドは`storage_path`の先頭セグメントがログインユーザーの`user_id`と一致するかを検証してからINSERTする。
3. 表示時は、フロントが`supabase.storage.from('photos').createSignedUrl(path, 3600)`を直接呼んで期限付きURLを取得する(バックエンドを経由しない)。

### 4.4 `storage.objects`に対するRLSポリシー(`photos`バケット)

```sql
create policy "own folder insert"
  on storage.objects for insert
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own folder select"
  on storage.objects for select
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

## 5. API仕様

Next.js の Route Handlers(`app/api/**/route.ts`)として実装する。認証は Supabase Auth のセッションを各ハンドラで検証する前提。

| Method | Path | 用途 | 担当 |
|---|---|---|---|
| POST | `/api/diaries` | 日記を1件作成 | あなた |
| GET | `/api/diaries` | 自分の日記一覧を取得 | あなた |
| POST | `/api/photos` | フロントが直接Storageへアップロード済みの`storage_path`を`photos`に記録(4.3参照、バックエンドは自分の`user_id`配下かのみ検証) | あなた |
| POST | `/api/obsessions` | 蓄積済みの日記・写真からAI連携①を呼び、`obsessions`を1件作成 | あなた(取次ぎ)+AI担当(中身) |
| GET | `/api/obsessions` | 抽出済み偏愛の一覧 | あなた |
| POST | `/api/movies` | 指定した`obsession_id`から映画生成ジョブを開始(`status=pending`で即時レスポンス) | あなた(取次ぎ)+AI担当(中身) |
| GET | `/api/movies/:id` | ポーリング用。`status`と(完成していれば)`video_path`を返す | あなた |
| GET | `/api/movies` | 自分の映画一覧 | あなた |

## 6. AI連携ポイント(佐藤佑作さんへの接続点)

バックエンドの取次ぎ処理は契約①②の関数を**呼び出すだけ**とする。API呼び出し・プロンプト設計・契約③の動画生成adapter実装はAI担当の実装範囲とし、この章では境界となるJSON契約を固定する。

- 実装(取次ぎ処理): あなた
- 実装(AI処理本体): 佐藤佑作

### 契約① 偏愛分析 — `lib/ai/analyzeObsession.ts`

```ts
// あなたが呼ぶ側
type Input = {
  diaryTexts: string[];   // ユーザーの日記本文
  photoUrls: string[];    // Supabase Storage の署名付きURL
};

// 佐藤さんが実装する側の戻り値。obsessions.analysis_json にそのまま保存する。
type ObsessionAnalysis = {
  title: string;          // "夜の電車"
  reason: string;
  keywords: string[];
  emotion: string[];
  evidence: {
    sourceType: "diary" | "photo";
    summary: string;
  }[];
  visualMotifs: string[];
};
```

`evidence`には偏愛と判断した日記・写真上の根拠を保存する。`visualMotifs`は映画構成で繰り返し使う色、物、場所などの視覚的モチーフである。

### 契約② 映画構成生成 — `lib/ai/generateMovieScript.ts`

```ts
type Input = {
  obsession: ObsessionAnalysis;
  photoUrls: string[];
};

// movies.movie_json にそのまま保存する。動画生成AI呼び出しの入力にもなる。
type MovieScript = {
  title: string;
  logline: string;
  synopsis: string;
  visualStyle: string;
  bgm: string;
  scenes: {
    order: number;
    source: string;
    duration: number;
    narration: string;
    videoPrompt: string;
    referencePhotoUrls: string[];
  }[];
};
```

`videoPrompt`は動画生成APIへ渡す英語のシーン別プロンプトとする。MVPでは3〜5シーン、各5〜6秒、合計15〜30秒を基本とする。ユーザー写真を使うシーンは`referencePhotoUrls`を指定し、image-to-videoで生成する。

実際の動画生成AI呼び出し・BGM合成・レンダリングは、この2契約の外側(AI担当の実装内)で完結させ、完了後に`movies.status`を`completed`へ変更し、`video_path`を更新する。バックエンド側はprovider/model固有SDKを参照しない。

### 契約③ 動画生成adapter — `lib/ai/video/VideoGenerator.ts`

```ts
type GenerateSceneInput = {
  prompt: string;
  duration: number;
  referenceImageUrls: string[];
};

type GenerateSceneResult = {
  providerJobId: string;
  videoUrl?: string;
};

interface VideoGenerator {
  generateScene(input: GenerateSceneInput): Promise<GenerateSceneResult>;
}
```

MVP実装は`gemini-omni-1.1-flash`を呼び出す。将来RunwayやLumaへ変更する場合も、Route HandlerやDBアクセス層は変更せず、このadapter実装だけを差し替える。

## 7. 非同期処理とステータス遷移

ポーリング方式(判断⑤)。フロントは`GET /api/movies/:id`を数秒間隔で叩き、`status`を見て進捗バーを更新する。

```
pending    生成ジョブ受付済み
  ↓
analyzing  契約①実行中
  ↓
generating 契約②実行中
  ↓
processing Geminiでシーン生成 + FFmpegで結合・字幕・BGM処理
  ↓
completed  video_path 確定
```

`failed`はこの列から外れた例外状態として`error_message`とともに返る(補完項目、2章参照)。

動画生成は長時間化する可能性があるため、ブラウザからGemini APIを直接呼ばない。サーバーまたはワーカーが処理し、APIキーはサーバー環境変数にのみ保存する。同じmovie/sceneの二重生成を防ぐため、実装時にprovider側のjob ID、シーン別状態、再試行回数を記録する。

## 8. 残る未確定事項

- **要確認(判断⑧)**: ハッカソンの新しい提出期限(8/31は経過済み)。今回のスコープでは影響しないが、AI連携・フロント結線の着手時期に関わるため別途確認を推奨。
- **実装時に決定**: provider側のjob IDとシーン別生成状態を`movies.movie_json`へ含めるか、専用テーブルへ分離するか。MVPでは`movie_json`への保存で開始し、再生成や監査要件が増えた場合にテーブル分離を検討する。

---
Electric-Sheep-team6 / hackson-no-yatu / 江藤拓海作成
