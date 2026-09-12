# LAST SCREEN frontend

Supabase をバックエンドに使う Next.js アプリです。画面から以下の一連の操作を実行できます。

- メール／パスワードで登録・ログイン
- 日記を `POST /api/diaries` に保存
- 写真・動画を private `photos` バケットへアップロードし、`POST /api/photos` で記録
- `POST /api/obsessions` で偏愛を分析
- `POST /api/movies` で映画生成を開始し、`GET /api/movies/:id` を2秒ごとにポーリング

## Getting Started

## Setup

`.env.local.example` をコピーして `.env.local` を作成し、Supabase プロジェクトの値を設定します。

```bash
cp .env.local.example .env.local
```

`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` は必須です。DB と Storage はリポジトリ直下の `supabase/migrations` を Supabase プロジェクトへ適用してください。

依存関係を入れ、開発サーバーを起動します。

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開き、右上から登録またはログインしてください。メール確認を有効にしている場合は、登録後に確認メールを完了してからログインします。

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
