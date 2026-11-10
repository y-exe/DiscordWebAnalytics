# セットアップ

[目次](../README.md)

## 必要環境

- [Bun](https://bun.sh/) 1.3以上
- PostgreSQL 16以上 (TLS推奨)
- Node.js環境での開発 (フロントエンドのNext.js devもBunで動作)

## リポジトリ構成

| ディレクトリ | 役割 |
| --- | --- |
| `Bot/` | データ収集Botとスラッシュコマンド (discord.js) |
| `backend/` | REST API (Hono)。統合コンテナではNext.jsに `/api` としてマウント |
| `frontend/` | ダッシュボード (Next.js App Router) |
| `db/` | スキーママイグレーションランナーとSQL |
| `scripts/` | 管理者パスワードハッシュ生成ツール |

## 1. データベース

PostgreSQLにデータベースを作り、接続用のロールを用意します。`DB_DSN` は次の形式です。

```
postgresql://user:password@host:5432/dbname?sslmode=require
```

スキーマはマイグレーションで作成します (既存テーブルがあっても不足分だけ作成し、既存データは変更しません)。

```bash
cd db && bun install && bun run migrate
```

`DB_DSN` は環境変数、`Bot/.env` または `backend/.env` から読み込みます。アプリのデプロイ前にマイグレーションを実行してください。

## 2. 環境変数

| 変数 | 用途 |
| --- | --- |
| `DB_DSN` | PostgreSQL接続文字列 (必須) |
| `DISCORD_TOKEN` | Botトークン (Botのみ) |
| `GUILD_ID` 等 | 既定ギルドのシード値 ([初期設定](../guide/setup.md)) |
| `API_SECRET` | API認証用シークレット (32文字以上) |
| `ADMIN_SESSION_SECRET` | 管理者セッション鍵 (32文字以上) |
| `ADMIN_PASSWORD_HASH` | 管理者パスワードハッシュ (ソルト付きPBKDF2-HMAC-SHA-256) |
| `SUBDOMAIN_BASE_DOMAIN` | テナントサブドメインの基準ドメイン (既定: `yexe.top`) |
| `SERVER_PUBLIC_IP` | 独自ドメインのDNS検証に使うVPS IP |

`ADMIN_PASSWORD_HASH` は次のコマンドで生成します。

```bash
cd scripts && bun install && bun run generate:admin-password-hash
```

## 3. 起動

```bash
bun run bootstrap   # 依存の初期インストール
bun run dev         # Bot/backend/frontend を同時起動
```

| コマンド | 内容 |
| --- | --- |
| `bun run check` | lint・型検査・テスト |
| `bun run build` | フロントエンドのビルド |
| `bun run format` | コード整形 |

## Docker

イメージはリポジトリルートをコンテキストにビルドします (共有ソースを含めるため)。

```bash
docker build -f Bot/Dockerfile .
docker build -f backend/Dockerfile .
```

本番はk3s上で統合コンテナ (`frontend/` をNext.js SSR + `/api` マウント) とBotのみで動かしています。詳細は[デプロイ](deploy.md)へ。

## 健康確認

| エンドポイント | 内容 |
| --- | --- |
| `/api/health` | API (DB接続込み) |
| `/healthz` | Next.jsネイティブルート (DB非依存) |

## マルチテナント運用

1つのBot・1つのDBで複数サーバーを集計します。Hostヘッダー (または `x-forwarded-host`) でギルドを解決し、`guilds` テーブルの設定で描画します。設計と進捗は [multi-guild.md](../multi-guild.md) を参照してください。
