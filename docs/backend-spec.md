# LAST SCREEN バックエンド仕様 v1.0

- 作成: 江藤拓海(処理・DB担当) / チーム たきささえ / Electric Sheep 2026「LAST SCREEN」
- 作成日: 2026-09-03
- スコープ: DB設計 + バックエンドAPI設計のみ(9/3中の完了目標)
- 前提: Web版(Next.js + Vercel + Supabase)

## 0. この仕様の前提(チームで確認済みの判断)

1. **技術スタック** — Web版(Next.js + Vercel + Supabase)。チーム全体合意済み。
2. **AI連携** — 偏愛分析・映画構成生成はAI担当(佐藤佑作)が実装。バックエンドは接続点(インターフェース)だけ用意する。
3. **AIモデル選定** — 何のAPIを使うかはAI担当マター、最終決定はチーム会議。バックエンドはモデル非依存に作る。
4. **DBスキーマ** — ChatGPT叩き台(users/diaries/photos/obsessions/movies)をそのまま採用して着手。
5. **非同期処理** — ポーリング方式。
6. **個人情報** — プロトタイプ完成優先。同意取得・削除フローは対象外(今回のスコープ外)。
7. **スコープ** — 9/3中に完了させるのはDB設計とバックエンド設計の部分のみ。AI・フロント結線は別担当・別スケジュール。

未確定のまま残っている論点(③AIモデルの具体的選定、⑧ハッカソンの新しい提出期限)は末尾の「6. 残る未確定事項」を参照。

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
  └─▶ AI連携ポイント(4章) ── 佐藤佑作(AI担当)が中身を実装
           │
           ▼
      動画生成AI → Supabase Storage → Web再生
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
  analysis_json jsonb not null,      -- 4章 契約①の出力そのまま
  created_at    timestamptz not null default now()
);

create table movies (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  obsession_id   uuid not null references obsessions(id) on delete cascade,
  status         text not null default 'pending'
                 check (status in ('pending','analyzing','generating','processing','completed','failed')),
  movie_json     jsonb,             -- 4章 契約②の出力(章構成・シーン台本)
  video_path     text,              -- 完成後の Supabase Storage パス
  error_message  text,              -- failed 時の原因(補完項目)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

補完した点: `error_message`と`status='failed'`(生成失敗時にポーリング側が無限待ちにならないよう必須)、`updated_at`(ステータス変化の追跡)、各テーブルの外部キー制約(整合性維持)。DB担当としてこの3点を追加した。

## 3. API仕様

Next.js の Route Handlers(`app/api/**/route.ts`)として実装する。認証は Supabase Auth のセッションを各ハンドラで検証する前提。

| Method | Path | 用途 | 担当 |
|---|---|---|---|
| POST | `/api/diaries` | 日記を1件作成 | あなた |
| GET | `/api/diaries` | 自分の日記一覧を取得 | あなた |
| POST | `/api/photos` | 画像をSupabase Storageへアップロードし`photos`に記録 | あなた |
| POST | `/api/obsessions` | 蓄積済みの日記・写真からAI連携①を呼び、`obsessions`を1件作成 | あなた(取次ぎ)+AI担当(中身) |
| GET | `/api/obsessions` | 抽出済み偏愛の一覧 | あなた |
| POST | `/api/movies` | 指定した`obsession_id`から映画生成ジョブを開始(`status=pending`で即時レスポンス) | あなた(取次ぎ)+AI担当(中身) |
| GET | `/api/movies/:id` | ポーリング用。`status`と(完成していれば)`video_path`を返す | あなた |
| GET | `/api/movies` | 自分の映画一覧 | あなた |

## 4. AI連携ポイント(佐藤佑作さんへの接続点)

あなたはこの2つの関数を**呼び出すだけ**。中身(どのモデルを使うか・プロンプト設計)はAI担当の実装範囲。入出力のJSON契約だけをここで固定する。

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
};
```

### 契約② 映画構成生成 — `lib/ai/generateMovieScript.ts`

```ts
type Input = {
  obsession: ObsessionAnalysis;
  photoUrls: string[];
};

// movies.movie_json にそのまま保存する。動画生成AI呼び出しの入力にもなる。
type MovieScript = {
  title: string;
  bgm: string;
  scenes: { source: string; duration: number; prompt: string }[];
};
```

実際の動画生成AI呼び出し・BGM合成・レンダリングは、この2契約の外側(AI担当の実装内)で完結させ、完了後に`movies.status`を`completed`・`video_path`を更新してもらう形にする。バックエンド側はどのモデルを使うか(判断③)を一切知らなくてよい設計にしてある。

## 5. 非同期処理とステータス遷移

ポーリング方式(判断⑤)。フロントは`GET /api/movies/:id`を数秒間隔で叩き、`status`を見て進捗バーを更新する。

```
pending    生成ジョブ受付済み
  ↓
analyzing  契約①実行中
  ↓
generating 契約②実行中
  ↓
processing 動画生成AI + BGM合成
  ↓
completed  video_path 確定
```

`failed`はこの列から外れた例外状態として`error_message`とともに返る(補完項目、2章参照)。

## 6. 残る未確定事項

- **要チーム会議(判断③)**: 偏愛分析・映画構成生成に使うLLM、動画生成AIの具体的な選定。本仕様は契約①②のJSON形状さえ守ればモデルを問わないため、この会議の結論を待たずにバックエンド・DB実装を進めて問題ない。
- **要確認(判断⑧)**: ハッカソンの新しい提出期限(8/31は経過済み)。今回のスコープでは影響しないが、AI連携・フロント結線の着手時期に関わるため別途確認を推奨。

---
Electric-Sheep-team6 / hackson-no-yatu / 江藤拓海作成
