<div align="center">
<h1>
  Discord Server Web Analytics
  
  [![discord.js](https://img.shields.io/badge/discord.js-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.js.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Hono](https://img.shields.io/badge/Hono-FF5A00?style=flat-square&logo=hono&logoColor=white)](https://hono.dev/)
  [![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
  [![License GPL v3](https://img.shields.io/badge/LICENSE-GPL%20v3-green.svg?style=flat-square)](LICENSE)
</h1>
Discord鯖のアクティビティ収集、集計、可視化するための統合システムです。<br>
discord.jsによるデータ収集、Honoによるデータ提供、Next.js/ReactによるWebダッシュボードで構成。Bot/バックエンドのランタイムは[Bun](https://bun.sh/)です<br>
<br>

<img src="public/dashboard.png" alt="dashboard">
<br>
<sub>Webダッシュボード</sub>
</div>
<br/>

## なんのためにつくった...?

Discordの今までのチャット履歴等を全て取得し、視覚化するため！！
もとは月の発言ランキングの集計のために使っていたものを改造したものです。
公開Botとかにする予定は今のところないので(db死ぬので)、使いたい人はライセンスの下改造してね！！

## 機能など...

### データ収集

- Botはメッセージの送信日時、文字数、チャンネルのみを保存します。※メッセージ本文は保存しません。
- 削除されたユーザー（Deleted User）やBotが認識できないユーザーは、ランキングおよび個人推移グラフから自動的に除外されます。

### Webダッシュボード

- サーバー全体の活動量、ヒートマップ、チャンネル別分布を表示。
- ユーザーごとの発言数推移を折れ線グラフで可視化。
- ログイン中のユーザーおよび検索したユーザーのデータをグラフ上で比較可能。

## ディレクトリ構成

```
- 案内ホームページ (ymkw.top) は独立リポジトリ [y-exe/ymkw.top](https://github.com/y-exe/ymkw.top) (Vue 3 + Vite、Cloudflare Pagesで配信)
- Bot/ : データ収集およびコマンド操作を行うDiscordBot (discord.js + TypeScript)
- backend/ : データベースと通信し、フロントエンドにJSONを提供するRESTAPI (Hono + TypeScript)
- frontend/ : ダッシュボード (Next.js App Router + React) — analytics.ymkw.top および各ギルドのドメインで配信
- db/ : スキーママイグレーションランナー (TypeScript) とSQLファイル
- scripts/ : 管理者パスワードハッシュ生成ツール
```

## ホームページとダッシュボードの分離

- `ymkw.top` は案内ホームページ専用 (独立リポジトリ `y-exe/ymkw.top`、Cloudflare Pagesで配信)。ダッシュボードは含まない
- ダッシュボードは `analytics.ymkw.top` (メインギルド) および各ギルドが設定した自分のドメインで配信される (k3s上のNext.js)
- ダッシュボードのルート `/` は最新の公開月 (`/month/latest`) へリダイレクトする

## 環境変数について

- `API_SECRET`: 32文字以上のランダム値。(バックエンド用)
- `ADMIN_SESSION_SECRET`: 32文字以上のランダム値。バックエンドとフロントエンド同様
- `ADMIN_PASSWORD_HASH`: ソルト付きPBKDF2-HMAC-SHA-256形式管理者パスハッシュ
- `TRUST_CLOUDFLARE_PROXY`: originへの直接接続を遮断した場合に限り`true`
- `CLOUDFLARE_TRUSTED_PROXY_CIDRS`: `CF-Connecting-IP`を信頼する接続元CIDRをカンマ区切りで設定
Cloudflareがオリジンへ直接接続する構成では、[Cloudflare公式IP一覧](https://www.cloudflare.com/ips/)と同期してください。Cloudflare Tunnelや手前のリバースプロキシを使う場合は、APIサーバーから見える直前のプロキシCIDRを指定
`ADMIN_PASSWORD_HASH`は次のコマンドで生成し、出力された1行全体をCloudflareの環境変数へ設定。
```bash
cd scripts && bun install && bun run generate:admin-password-hash
```

## フロントエンド開発・デプロイ

`frontend/`はNext.js App Routerです。開発には`npm run dev`、通常ビルドには`npm run build`を使います。
Cloudflare Workers向けの成果物は`npm run cf:build`で生成し、`npm run preview`でWorkersランタイムを確認できます。実際の配備は`npm run deploy`です。
環境変数は`NEXT_PUBLIC_API_URL`、`NEXT_PUBLIC_ADMIN_API_URL`、`GA_ID`を利用します。サーバー専用のAPI URLを分ける必要がある場合は`API_URL`を設定します。

## Discordでの月間レポート共有

月間レポートURLのHTMLは、公開済み月に限り`discord:component-embed`のリンクをサーバー側で出力します。`/ranking/monthly/{year}/{month}/discord-embed`はBotのランキングメッセージと同じ共通描画処理・集計条件を使用します。バックエンドはリクエストのHostヘッダー(または`x-forwarded-host`)でギルドを解決し、`guilds`テーブルの設定(発言王ロール・除外チャンネル・ダッシュボードドメイン)を使って描画します。`GUILD_ID`は未登録ホスト(`api.ymkw.top`等)向けの既定ギルド指定です。未公開月のJSONは認証済みでも公開しません。Discordの3,000バイト制限を超える場合は順位・氏名を削らず、通常のOpen Graphプレビューへフォールバックします。

## マルチサーバー対応

SaaS型マルチテナント(1つのBot・1つのDBで複数サーバー)へ移行しています。設計と進捗は`docs/multi-guild.md`を参照してください。

- `ymkw.top`は案内ホームページ(独立リポジトリ `y-exe/ymkw.top`)、ダッシュボードは`analytics.ymkw.top`と各ギルドのドメインで提供し、フロントとAPIは同一オリジンで動作する
- ギルド設定(告知チャンネル・月間発言王ロール・ランキング除外チャンネル)はDBの`guilds`テーブルで管理し、Botの`/setup`コマンド(サーバー管理権限が必要)で変更できます。
- `GUILD_ID`・`KING_ROLE_ID`・`ANNOUNCE_CHANNEL_ID`・`EXCLUDED_CHANNEL_IDS`(カンマ区切り)は既定ギルドのシード値です。起動時に`guilds`テーブルの未設定列のみを埋め、`/setup`による設定を優先します。
- 表示名はギルドごとに`guild_members`テーブルへ保存され、ランキングはそのギルドの表示名で集計されます。

Dockerイメージは共有ソースを含めるためリポジトリルートをコンテキストにしてビルドします(例: `docker build -f Bot/Dockerfile .`、`docker build -f backend/Dockerfile .`)。

累計ランキング`/all`もComponent Embedに対応し、`/ranking/total/discord-embed`からBotの`/all`と同じ集計・描画処理で全期間の上位10人を表示します。月間ロールの案内は含めません。

## データベースのスキーマ変更

月間の発言王ロールは日本時間の前月を対象に、Bot起動時と60秒ごとの確認で、`guilds`テーブルに`king_role_id`が設定された全ギルドへ更新します。`KING_ROLE_ID`の既定値は`1503873180362739834`です。完了月は`monthly_role_runs`へ記録し、再起動時の重複実行を防ぎます。更新失敗時は完了扱いにせず再試行します。Botには対象ロールより上のロールと「ロールの管理」権限が必要です。月間レポートの共通入口`/month/latest`は、アクセス時の日本時間を基準に最新公開月へリダイレクトします。

PostgreSQLのDDLは`db/migrations/`で管理します。BotやAPI、履歴スキャナーの起動時にはスキーマを変更しません。

既存DBへの初回導入時も、初期マイグレーションは既存テーブル・インデックスを確認して不足分だけ作成し、既存データは変更しません。DB接続可能な環境で次を実行してください。

```bash
cd db && bun install && bun run migrate
```

`DB_DSN`は環境変数、`Bot/.env`または`backend/.env`から読み込みます。スキーマを必要とするアプリを更新するときは、アプリのデプロイ前にマイグレーションを実行してください。適用済みのマイグレーションファイルは編集せず、新しい番号のSQLファイルを追加します。`CREATE INDEX CONCURRENTLY`などトランザクション外で実行するSQLは、ファイルの先頭に`-- migrate: no-transaction`を指定し、1ファイルにつき1ステートメントにします。

## PostgreSQLの集計診断

`db/diagnostics.sql`は一時ファイル書き出し量、`pg_stat_statements`のクエリ統計、テーブルとインデックスのサイズを確認します。クエリ統計を使うには、PostgreSQLの起動設定で`pg_stat_statements`を事前ロードして再起動した後、マイグレーションを実行します。診断SQLの実行自体は読み取り専用です。

## 開発ツール

Bun 1.3.14、Biome、Turborepoを使用します。

```bash
bun run bootstrap
bun run dev
```

| コマンド | 内容 |
|---|---|
| `bun run check` | lint・型検査・テスト |
| `bun run build` | フロントエンドのビルド |
| `bun run format` | コード整形 |
| `bun run format:check` | 整形差分の確認 |

依存変更時は、Bunとnpm/Docker用のロックファイルを更新してください。

## ライセンス

[GPL-3.0](LICENSE)

---
© 2026 ymkw.top
