# Supabase セットアップ手順

この文書は、Supabase 側でオーナーが行う作業をまとめたものです。現在のリポジトリには Supabase 接続コード、`supabase/` ディレクトリ、DB マイグレーションはまだありません。**いまはプロジェクト作成と接続情報の保管まで**行い、テーブル作成や SQL の実行、Vercel の環境変数登録はコード側の準備ができるまで待ってください。

## いま行うこと

### 1. Supabase プロジェクトを作る

- まだプロジェクトがなければ Supabase にログインし、開発用プロジェクトを1つ作成します。既に作成済みなら次の項目を確認します。
- プロジェクト名は例として `poker-dev` にします。本番公開時は開発用と本番用を分けます。
- 主な利用者が日本なら、リージョンは東京（`ap-northeast-1`）を選びます。プロジェクトのリージョンは後から設定変更できず、移転には別プロジェクトへの移行が必要です。
- DB パスワードは十分に長くランダムなものを生成し、パスワードマネージャーに保管します。GitHub、チャット、ソースコードには書きません。
- まず Free プランで開発できます。Free プロジェクトは一定期間利用が少ないと一時停止されることがあるため、公開サービスの稼働保証には使わず、公開前に料金と上限を見直します。

リージョンはデータの保存場所にもなるので、選択前に [利用可能なリージョン](https://supabase.com/docs/guides/platform/regions)を確認してください。リージョン変更は新しいプロジェクトへの移行が必要です。[リージョン変更の説明](https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z)

### 2. 接続情報を自分の安全な場所に控える

Supabase Dashboard の **Connect** または API Keys の画面から、次の2つを確認します。

- Project URL
- Publishable key（`sb_publishable_...`）

値はパスワードマネージャーなどに保管し、ここへ貼り付ける必要はありません。Publishable key はブラウザーで使える公開識別子で、秘密情報ではありません。実際に読み書きできるデータは PostgreSQL の権限と RLS ポリシーで制御するため、RLS を必ず設定します。

**Secret key（`sb_secret_...`）はブラウザーに置かず、Git に登録せず、チャットにも送らないでください。** Secret key は RLS を迂回できるため、後でサーバー処理に必要になった場合のみ Vercel のサーバー環境変数に登録します。現在のアプリはまだ環境変数を読み込みませんので、Vercel への登録は保留してください。

Supabase は新しいプロジェクトでは Publishable / Secret keys を案内しています。キーの役割は[公式 API キー説明](https://supabase.com/docs/guides/getting-started/api-keys)と[データ保護ガイド](https://supabase.com/docs/guides/database/secure-data)を参照してください。

## コード接続時に行うこと

以下はコード側にマイグレーションと接続実装が追加されたあとに行います。**Dashboard の SQL Editor で独自にテーブルを作らないでください。** 以後のスキーマ変更はリポジトリで管理するマイグレーションから適用します。

### 3. ゲスト認証を有効にする

- Supabase Dashboard の Authentication 設定で Anonymous Sign-Ins を有効にします。
- 匿名ユーザーは DB では `authenticated` ロールとして扱われます。`anon` と同じ権限だと考えず、RLS ポリシーで `is_anonymous` claim とルーム参加状態を確認します。
- ブラウザーデータ消去や端末変更後は匿名アカウントを復元できない場合があります。ゲスト利用時にこの制約を利用者へ表示します。
- 公開前に匿名アカウント作成へのレート制限や CAPTCHA の要否を確認します。

[Anonymous Sign-Ins の公式ガイド](https://supabase.com/docs/guides/auth/auth-anonymous)

### 4. DB と RLS をマイグレーションから作る

- こちらから SQL マイグレーションと適用手順を提示してから実施します。
- 全ての公開テーブルで RLS を有効にし、必要な操作だけ許可します。
- ルーム状態、メンバー、セッションを誰が読めて誰が更新できるかをポリシーで制限します。
- 手札・未配札デッキ・勝敗をクライアントから直接書き換えられるポリシーは作りません。勝敗を決めるアクションはサーバー側で検証します。
- マイグレーションをローカルでテストし、差分を Git に記録してからリモートへ適用します。

Supabase はスキーマ変更をマイグレーションファイルで管理する手順を案内しています。[Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)

### 5. Realtime を設定する

- Realtime の Broadcast / Presence を使う場合、チャンネルを private にし、`realtime.messages` の RLS ポリシーでルーム参加者だけに購読・送信を許可します。
- Realtime の設定で public channel access を無効にする作業は、対応する認可ポリシーを用意してから行います。設定変更時は接続中のクライアントが切断されることがあります。
- 配信には状態更新の通知と公開情報だけを使います。プレイヤーの非公開手札、未配札デッキ、認証トークンをチャンネルへ流しません。

[Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) · [Broadcast](https://supabase.com/docs/guides/realtime/broadcast)

### 6. Vercel の環境変数を登録する

コード側の接続実装が追加されたら、README または実装時の案内に記載する**正確な変数名**で Vercel の Project Settings → Environment Variables に登録します。Development / Preview / Production のどの環境で使うかを確認してください。

- ブラウザー向け URL と Publishable key だけをフロントエンド用の公開変数にします。
- Secret key、DB パスワード、署名鍵はサーバー専用変数にし、`VITE_` や `NEXT_PUBLIC_` のような公開プレフィックスを付けません。
- 値を登録・変更したら、新しいデプロイを行います。
- 開発環境と本番環境で別プロジェクトを使う場合、値を混ぜないよう環境ごとに確認します。

このリポジトリの現在の画面は Vite の静的サイトです。Supabase 接続後の環境変数名や Vercel Function の構成は、コードを追加するときに確定します。現時点では名前を推測して登録しないでください。

## 公開前の確認

- [ ] 無料枠の DB 容量、通信量、Realtime 同時接続などの上限を最新の料金ページで確認した
- [ ] Free プランの非アクティブ時の一時停止を許容できるか決めた
- [ ] Security Advisor の指摘を確認した
- [ ] ブラウザーの Publishable key で RLS が想定どおり機能することを検証した
- [ ] 別ユーザーが他人のルームや非公開カードを取得できないことを確認した
- [ ] Vercel Preview と Production の接続先・環境変数を確認した
- [ ] 料金通知・バックアップ・障害時の復旧方法を確認した

Free プランは利用が少ないプロジェクトを7日間程度の低活動後に一時停止する場合があります。最新の条件は[プロジェクト一時停止の説明](https://supabase.com/docs/guides/platform/free-project-pausing)と[料金ページ](https://supabase.com/pricing)で再確認してください。

## 作業完了時に共有する内容

次のように、**秘密値を含めず**状態だけを教えてください。

- 開発用 Supabase プロジェクトを作成したか
- 選んだリージョン
- Project URL と Publishable key を手元に控えたか（値そのものは送らない）
- Anonymous Sign-Ins を有効にしたか
- Free / 有料のどのプランで始める予定か

DB パスワード、Secret key、接続文字列、認証トークンは共有しないでください。
