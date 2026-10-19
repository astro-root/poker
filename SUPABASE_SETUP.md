# Supabase セットアップ

オンライン対戦は匿名ゲスト認証、Postgres の非公開ルームテーブル、`rooms` Edge Function を使います。ホストのブラウザーは配札・相手の手札・山札を受け取りません。

## プロジェクト設定

1. Supabase プロジェクトを用意し、Authentication で **Anonymous Sign-Ins** を有効にします。
2. Project URL と Publishable key を `.env.local` の `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` に設定します。これらはブラウザー用の公開値です。
3. `.env.local` は Git に登録しません。Secret key、DB パスワード、認証トークンを `VITE_` 変数やブラウザーコードへ入れないでください。

匿名ログインはSupabaseの[公式ガイド](https://supabase.com/docs/guides/auth/auth-anonymous)、キーの役割は[APIキーガイド](https://supabase.com/docs/guides/getting-started/api-keys)を参照してください。

## DB と Edge Function のデプロイ

Supabase CLI が利用できる環境で、リポジトリのルートから実行します。

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy rooms
```

`db push` は `supabase/migrations/20261019000100_create_private_poker_rooms.sql` を適用します。ルームテーブルはRLSを有効にし、匿名ユーザーを含むブラウザーからの直接読込・更新を拒否します。関数のサーバー権限でのみ全状態を読み書きします。`rooms` 関数はJWT検証を有効にし、匿名ゲストを含む認証済み参加者だけを受け入れます。Supabase Edge Functions はサービスキーをサーバー実行環境へ注入します。手動でサービスキーをフロントエンドへ設定する必要はありません。

ローカル開発では `npx supabase start`、別ターミナルで `npx supabase functions serve rooms` を起動します。関数のローカル実行に必要な環境変数は Supabase CLI の案内に従ってください。

スキーマ変更はSQL Editorへ直接追加せず、`supabase/migrations` 内のマイグレーションとして管理します。[Supabase CLI](https://supabase.com/docs/guides/cli)と[Edge Functions のデプロイ](https://supabase.com/docs/guides/functions)の公式手順も参照してください。

## セキュリティ設計

- クライアントは部屋を作成・参加し、ルーム状態の取得やアクション送信を Edge Function に依頼します。
- 配札、勝敗判定、チップ精算はサーバー側のポーカーエンジンで実行します。
- 関数はリクエストのユーザーIDとアクション権限を検証し、DBリビジョンの比較更新で同時操作を拒否します。
- 応答から未配札デッキと他人の手札を除外します。ショーダウンの公開情報だけ全員へ返します。
- Supabase Realtime の public channel や WebRTC には手札を流しません。

本番公開前に、2つ以上の別ゲストアカウントで、ホストを含む各ブラウザーの応答に相手の手札・山札が含まれないこと、直接テーブルアクセスが拒否されることを確認してください。オンライン対戦はゲーム内チップのみで、現金・賞金はありません。
