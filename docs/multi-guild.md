# マルチサーバー (SaaS型マルチテナント) 対応設計

## 目標

- 1つのBot・1つのDBで複数のDiscordサーバーへ対応する (公開Bot化を視野)
- 各ギルドは自分のドメインでダッシュボードを開ける (CNAME接続)
- `ymkw.top` は設定済みドメインの1つ (既定ギルド用)
- ギルド設定 (告知チャンネル・発言王ロール・除外チャンネル等) はBotのスラッシュコマンドで管理
- 当月データの閲覧はDiscord OAuth (ギルドの管理者) で行う

## 現状の1サーバー前提箇所と対応方針

| 箇所 | 現状 | 対応 |
|---|---|---|
| `messages.guild_id` | 既にあり (loggerは全ギルド収集済み) | そのまま利用 |
| `channels` | guild_idなし。`UPDATE ... SET is_active=FALSE` が全ギルド破壊的 | `guild_id` 追加 + ギルド別に更新 |
| `users` | 表示名がグローバル1レコード | `guild_members` (guild_id, user_id) 新設。表示名・ギルド別アバターはこちら |
| guild_id先頭インデックス | 003/004で削除済み | `(guild_id, created_at, user_id)` を再作成 |
| `monthly_role_runs` | 既に (guild_id, role_id) 主キー | そのまま利用 |
| Bot `GUILD_ID` | sync / ranking / historyScanner が単一参照 | 全ギルドループ + `guilds` テーブル参照 |
| Bot 除外ch・発言王ロール・告知ch | 環境変数 / shared定数 | `guilds` テーブルへ移行 (`/setup` で変更) |
| backend 全データAPI | guildフィルタなし | guild解決 (ヘッダー/Host/パラメータ) + `WHERE guild_id` + キャッシュキー拡張 |
| backend whitelist/プラチャ設定 | config.tsにハードコード | `guilds.display_config` (JSONB) へ移行 |
| frontend | guild概念ゼロ、`ymkw.top` 直書き | middlewareでHost→ギルド解決、メタデータ・ブランディング動的化 |
| shared ランキング描画 | URL・注記がメインサーバー専用 | オプション化 (既定値は現状維持、フィクスチャテスト互換) |
| 管理者認証 | パスワード1つ (Cookie) | Discord OAuth (ギルド管理者スコープ) へ置換 |

## DBスキーマ (マイグレーション 006〜008)

```sql
-- guilds: ギルド設定の中心テーブル
CREATE TABLE guilds (
    guild_id BIGINT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    icon_url TEXT,
    announce_channel_id BIGINT,
    king_role_id BIGINT,
    excluded_channel_ids BIGINT[] NOT NULL DEFAULT '{}',
    display_config JSONB,           -- サイドバー表示ch等のギルド別表示設定
    is_active BOOLEAN NOT NULL DEFAULT TRUE,  -- Botが退出したらFALSE
    created_at / updated_at TIMESTAMPTZ
);

-- guild_domains: ダッシュボードのカスタムドメイン (Host解決用)
CREATE TABLE guild_domains (
    domain TEXT PRIMARY KEY,        -- 正規化済み (lowercase)
    guild_id BIGINT NOT NULL REFERENCES guilds ON DELETE CASCADE,
    created_at TIMESTAMPTZ
);

-- guild_members: ギルドごとの表示名・ギルド別アバター
CREATE TABLE guild_members (
    guild_id BIGINT NOT NULL REFERENCES guilds ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    updated_at TIMESTAMPTZ,
    PRIMARY KEY (guild_id, user_id)
);
```

- マイグレーション時に既存 `messages` から `guilds` / `guild_members` / `channels.guild_id` を復元する
- `guilds.name` は `''` で登録し、Botの同期で実際のサーバー名・アイコンを埋める
- 既定ギルド (`1355073968532619376`) には `KING_ROLE_ID`・除外ch・`display_config`・`ymkw.top` / `www.ymkw.top` をシード
- インデックスは `-- migrate: no-transaction` + `CREATE INDEX CONCURRENTLY` で1ファイル1ステートメント:
  - `idx_messages_human_guild_created_user (guild_id, created_at, user_id) WHERE is_bot = FALSE`
  - `idx_channels_guild ON channels (guild_id)`

## ランキングクエリ (shared)

- `monthlyRankingQuery(year, month, guildId, excludedChannelIds?)` / `totalRankingQuery(guildId, excludedChannelIds?)`
  - 除外チャンネルを配列化: `m.channel_id <> ALL($n::bigint[])` (空配列なら除外なし)
  - 表示名は `COALESCE(guild_members.display_name, users.display_name)`
- 既定の `excludedChannelIds` は従来の `EXCLUDE_CHANNEL_ID` 単体 (既存動作を維持)
- `buildRankingComponent` は末尾に `options` を追加し、ボタンURL・注記行をギルド別に差し替え可能にする (未指定なら現状出力と完全一致)

## Host → ギルド解決 (フロントエンド)

- Next.js `middleware.ts` が Host ヘッダーからギルドを解決する
  - 解決は中央API `GET /internal/resolve-guild?host=` (WorkerのCache APIでエッジキャッシュ)
  - APIパス (`/channels`, `/users`, `/ranking`, `/stats`) は同一オリジンのままmiddlewareが中央APIへrewriteし `x-guild-id` を付与
  - ページリクエストにはリクエストヘッダーでギルド情報を渡し、Server Componentが参照
- ギルドが未登録のドメインは既定ギルド (`ymkw.top`) として扱うか 404 (段階的に決定)

## Bot側の変更

- 起動時: 全キャッシュギルドを `guilds` にupsert (名前・アイコン・is_active)
- `guildCreate` / `guildDelete` で `is_active` を更新
- 環境変数 (`GUILD_ID`, `KING_ROLE_ID`, `ANNOUNCE_CHANNEL_ID`, `EXCLUDED_CHANNEL_IDS`) は「既定ギルドのシード値」として扱い、`guilds` 行のNULL値のみ埋める (`/setup` による上書きを優先)
- sync: 全ギルドをループし、チャンネルupsertに `guild_id` を含め、`is_active=FALSE` をギルド単位に限定。メンバーは `users` (グローバル) + `guild_members` (ギルド別表示名) に二重upsert
- logger: チャンネルupsertに `guild_id`、発言者を `guild_members` にも記録
- historyScanner: 全ギルドをループ、`saveChannels` の非アクティブ化をギルド単位に
- ranking: 集計・告知・発言王ロールを「設定のある全ギルド」へループ展開。`/month` `/all` は `interaction.guildId` を使用
- `/setup` コマンド (ManageGuild権限必要): `announce` / `king-role` / `exclude add|remove|clear` / `show`

## バックエンド側の変更 (後続フェーズ)

- 全データ系ルートで guildId を解決: `x-guild-id` ヘッダー (フロントmiddleware経由) → `guild` クエリパラメータ (Bot/直接呼び出し) → Host ヘッダー
- `guilds` テーブル由来のギルド別設定 (display_config, 除外ch) をキャッシュ付きでロード
- キャッシュキーに guildId を含める。ウォームループは「ドメイン設定のあるアクティブギルド」をループ
- `allowedOrigins` は `guild_domains` から動的生成
- embed系 (`discord-embed`) はHostまたはギルド指定で解決

## 認証 (後続フェーズ)

- Discord OAuth: 中央認証ドメインでコールバックを受領 (`redirect_uri` は固定URIしか登録できないため)
  - 中央コールバック → ギルドへの `MANAGE_GUILD` 権限確認 → 期限付きワンタイムトークンをギルドドメインへリダイレクト → ギルドドメイン上でセッションCookie発行
- セッションはギルドスコープを持つHMACトークン (現行 `adminAuth.ts` の拡張)
- 当月データの閲覧権限 = 「そのギルドの管理者」

## カスタムドメイン (後続フェーズ)

- `/setup domain <domain>` で申請 → CNAME確認 + HTTPチャレンジで所有権検証 → `guild_domains` へ登録
- Cloudflare for SaaS またはワイルドカード証明書での提供を想定

## 実装フェーズ

1. **DB + shared**: マイグレーション006〜008、ランキングクエリ・コンポーネントのギルド対応
2. **Bot**: 全ギルド同期・収集・ランキング・発言王ロール、`/setup` コマンド
3. **バックエンドAPI**: guild解決ミドルウェア、全ルートのguildフィルタ、キャッシュキー、display_config移行
4. **フロントエンド**: Host解決middleware、`ymkw.top` 脱ハードコード、ギルド別メタデータ
5. **Discord OAuth**: 当月データのギルド管理者認証
6. **カスタムドメイン**: 申請・検証フロー

各フェーズで `bun run check` (lint・型検査・テスト) を通し、DB変更はマイグレーション適用順 (アプリのデプロイ前) を守る。
