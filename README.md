競馬予想Webアプリ。JV-Link経由でWindows PCからSupabaseへ同期されたJRAデータをもとに、Claude APIでレース診断表を生成する。

## 技術スタック

- フロントエンド/バックエンド: Next.js (App Router)
- データベース: Supabase
- ホスティング: Vercel
- AI: Anthropic Claude API (Haiku 4.5 / Sonnet 5 / Opus 4.8 のモデル階層)

## セットアップ

```bash
npm install
cp .env.local.example .env.local
# .env.local に Supabase / Anthropic の認証情報を設定
npm run dev
```

[http://localhost:3000](http://localhost:3000) で確認できる。

## 環境変数

`.env.local.example` を参照。

| 変数名 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (クライアント/RLS経由アクセス用) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (サーバー専用、RLSバイパス) |
| `ANTHROPIC_API_KEY` | Claude API キー |

## ディレクトリ構成

```
src/
  app/                 Next.js App Router
  lib/
    supabase/
      client.ts        ブラウザ用Supabaseクライアント
      server.ts        Server Component/Route Handler用クライアント (RLS経由)
      admin.ts         service_role用クライアント (RLSバイパス、サーバー専用)
      session.ts        セッションrefresh用 (src/proxy.tsから呼び出し)
      database.types.ts テーブル型 (Supabase CLIで再生成する)
    claude/
      client.ts         Anthropicクライアント初期化 + モデル階層定義
      predict.ts         Haiku/Sonnet/Opus階層別の呼び出し関数
  proxy.ts               認証セッションrefresh用proxy (旧middleware.ts)
```

## Vercelへのデプロイ

1. GitHubリポジトリをVercelにインポート
2. Project Settings > Environment Variables に上記の環境変数をすべて設定
3. デプロイ (追加設定不要、標準のNext.js検出でビルドされる)

Supabaseの型を更新する場合:

```bash
npx supabase gen types typescript --project-id <project-id> > src/lib/supabase/database.types.ts
```
