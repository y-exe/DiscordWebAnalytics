# マルチサーバー (SaaS型マルチテナント) 対応設計

## 目標

- 1つのBot・1つのDBで複数のDiscordサーバーへ対応する (公開Bot化を視野)
- 各ギルドは自分のドメイン、または無料サブドメイン `〇〇.a.yexe.xyz` でダッシュボードを開ける
- サブドメインの `〇〇` はDiscordの招待コード (バニティURL含む)。失効した招待は無効化する
- ギルド設定 (告知チャンネル・発言王ロール・除外チャンネル等) はBotのスラッシュコマンドで管理
- 当月データの閲覧はDiscord OAuth (ギルドの管理者) で行う
- VPS/k3s側の負荷を極力増やさない (不変データは全面的にHTTPキャッシュ)

## アーキテクチャ決定 (確定事項)

- **フロントエンドはCloudflare WorkersからVPS側 (k3s) へ統合する**
  - Next.js SSR コンテナをk3sアプリ (`ymkw-frontend`) として追加。`bun --bun next start` で稼働
  - Workers用の `cf:build` / `deploy` は移行完了後に引退
- **フロントとAPIを同一オリジンで提供する** (`https://{domain}/api/*` → バックエンド)
  - CORS・サードパーティCookie問題が消滅し、Discord OAuthのセッションCookieが全ドメインで機能する
- **ギルド解決はHostヘッダーで行う** (独自ヘッダーは使わない)
  - DNSでしか作れないため偽装不可。エッジ (Caddy/Nginx) がHostを保持したままバックエンドへ転送する
- 本番インフラの正本は `vps` リポジトリ (`yexeserver:~/vps`)。トポロジは VPS Nginx (TLSエッジ) → WireGuard → k3s Traefik → アプリ

```
テナントドメイン / ○○.a.yexe.xyz
        │
VPS: Nginx (stream SNI分岐 / 後述フェーズ6)
        ├─ 既存ホスト名 (api.ymkw.top等) → 従来どおりNginxのHTTPS処理
        └─ マルチテナント系 (*.a.yexe.xyz + 登録済み独自ドメイン) → Caddy (on-demand TLS)
                │ WireGuard (10.77.0.2:80, Host保持)
        k3s Traefik
                ├─ /api/* → ymkw-backend (Hono・既存)
                └─ /*    → ymkw-frontend (Next.js SSR・新規)
```

## 現状の1サーバー前提箇所と対応方針

| 箇所 | 現状 | 対応 |
|---|---|---|
| `messages.guild_id` | 既にあり (loggerは全ギルド収集済み) | そのまま利用 |
| `channels` | guild_idなし。`UPDATE ... SET is_active=FALSE` が全ギルド破壊的 | ✅ `guild_id` 追加 + ギルド別に更新 |
| `users` | 表示名がグローバル1レコード | ✅ `guild_members` (guild_id, user_id) 新設 |
| guild_id先頭インデックス | 003/004で削除済み | ✅ `(guild_id, created_at, user_id)` を再作成 |
| Bot `GUILD_ID` | sync / ranking / historyScanner が単一参照 | ✅ 全ギルドループ + `guilds` テーブル参照 |
| backend 全データAPI | guildフィルタなし | Hostヘッダー解決 + `WHERE guild_id` + キャッシュキー拡張 |
| backend whitelist/プラチャ設定 | config.tsにハードコード | `guilds.display_config` (JSONB) へ移行 |
| frontend `ymkw.top` 直書き | api.ts・next.config・OGP | 相対パス化 (`/api/...`) + Host解決ヘルパー + Dockerfile |
| shared ランキング描画 | URL・注記がメインサーバー専用 | ✅ オプション化 (既定値は現状維持) |
| 管理者認証 | パスワード1つ (Cookie) | Discord OAuth (ギルド管理者スコープ) へ置換 |

## DBスキーマ (マイグレーション 006〜008 実装済み)

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

-- guild_domains: ダッシュボードのドメイン (Host解決用)
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

- マイグレーション時に既存 `messages` から `guilds` / `guild_members` / `channels.guild_id` を復元済み
- 既定ギルド (`1355073968532619376`) には `KING_ROLE_ID`・除外ch・`display_config`・`ymkw.top` / `www.ymkw.top` をシード済み
- インデックスは `-- migrate: no-transaction` + `CREATE INDEX CONCURRENTLY`:
  - `idx_messages_human_guild_created_user (guild_id, created_at, user_id) WHERE is_bot = FALSE`
  - `idx_channels_guild ON channels (guild_id)`
- フェーズ7で `guild_domains` に `source` ('primary'|'invite'|'custom')・`invite_code`・`is_active` を追加する

## ランキングクエリ (shared・実装済み)

- `monthlyRankingQuery(year, month, guildId, excludedChannelIds?)` / `totalRankingQuery(guildId, excludedChannelIds?)`
  - 除外チャンネルを配列化: `m.channel_id <> ALL($n::bigint[])` (空配列なら除外なし)
  - 表示名は `COALESCE(guild_members.display_name, users.display_name)`
- `buildRankingComponent` は `options` でボタンURL・注記行をギルド別に差し替え (未指定なら既定ギルド出力と完全一致)

## 同一オリジン化 (フェーズ3〜4)

- ブラウザからのAPI呼び出しは **相対パス `/api/...`**。エッジが `/api/*` をstripped pathでバックエンドへ転送する
- SSR (サーバーコンポーネント) はクラスター内のバックエンドService URLを直接呼ぶ (`API_URL` 環境変数)
- バックエンドは **Hostヘッダーでギルドを解決**する:
  1. `guild_domains` / `guilds` ルックアップ (キャッシュ付き)。未登録Hostは404
  2. 過渡期の `api.ymkw.top` は既定ギルドにフォールバック (移行完了後に廃止)
- ギルド別設定 (display_config, 除外ch) はバックエンドがキャッシュ付きでロード
- キャッシュキーに guildId を含める。ウォームループは「ドメイン設定のあるアクティブギルド」をループ
- `allowedOrigins` は同一オリジン化により縮小 (過渡期はymkw.top系を維持)

### 負荷対策

- **公開済み月のページ・APIレスポンスは不変データ** → `s-maxage` / Next.js fetch cache で全面キャッシュ
- 当月 (未公開) のみSSR/DBクエリが走る。Bot起動時のウォームループで当月分を温める
- SSRコンテナのメモリ目安は 300〜500MB。k3sの `apps` ネームスペースに追加 (NetworkPolicyの許可リスト更新が必要)

## サブドメイン (フェーズ7)

- ベースドメイン: `a.yexe.xyz` (ワイルドカードDNS `*.a.yexe.xyz` → VPS IP、DNS-only)
- コードの決定 (`/setup subdomain [code]`):
  1. 引数指定があればそのコード (`GET /invites/{code}` で実在・自ギルド归属を検証してから紐付け)
  2. 無指定ならギルドのバニティURL (カスタム招待) を優先
  3. バニティも無ければBotが無期限招待を発行し、そのコードを使う
- 文字種は小文字英数字とハイフンに正規化 (大文字・`_` はDNS/証明書で問題が出るため)。未対応文字は拒否して代替を提示
- **失効チェック**: Botが6時間ごとに `GET /invites/{code}` を確認 → 404 または別ギルドの招待になっていたら `guild_domains` を無効化
- 失効コードは別サーバーが再取得できる場合があるが、再紐付けは必ず当該ギルドの `/setup` 実行 (管理者承認) を要求するため、なりすましは発生しない
- 証明書: `*.a.yexe.xyz` の**ワイルドカード証明書1枚** (DNS-01、yexe.xyzゾーンのCloudflare APIトークン + certbot-dns-cloudflare)。サブドメイン追加ごとの証明書作業は不要

### ベースドメインの証明書トレードオフ (インフラ作業時に再確認)

- `a.yexe.xyz` (2階層ワイルドカード) を **DNS-only** にすると証明書は無料だが、VPSが直接露出する (既存サイトのcloudflare-only保護は維持される。マルチテナントvhostのみ除外)
- Cloudflareプロキシ (orange) を使う場合は2階層ワイルドカード証明書に Total TLS / ACM ($10/月) が必要
- **1階層の専用ドメイン (例: 別TLDを1枚取得) なら Universal SSL の無料ワイルドカード + Cloudflare保護をそのまま使える**。ドメイン取得コストと$10/月を天秤に、インフラ実装時に決定する

## テナント独自ドメイン (フェーズ6・7)

- Caddy (VPSエッジ) の on-demand TLS で証明書を自動発行する
  - `ask` エンドポイント: バックエンド `GET /internal/caddy-ask?domain=` が `guild_domains` の登録済みドメインなら200
  - VPS Nginxは `stream` + `ssl_preread` でSNI分岐: 既存ホスト名 → 従来のHTTPS処理、それ以外 → Caddy
- `/setup domain <domain>` で申請 → DNS確認 (CNAME/AがVPSを指しているかのHTTP検証) → `guild_domains` へ登録
- apex (example.comのルート) もAレコードで対応可能 (Caddyが直接終端するため)

## 認証 (フェーズ5)

- Discord OAuth: ギルドの管理者 (`MANAGE_GUILD`) が当月データを閲覧できる
- `redirect_uri` はDiscordアプリに固定登録しかできないため、**中央コールバックドメイン**で受け、ワンタイムトークン付きで各ドメインへリダイレクトして同一オリジンCookieを発行する
  - 中央: `https://api.ymkw.top` 配下でコールバック受領 (既存adminAuth.tsのHMACトークン機構を拡張し、guildスコープ + DiscordユーザーIDを持たせる)
  - 遷移: ダッシュボードの「ログイン」→ Discord同意 → 中央コールバック → `https://{domain}/auth/complete?token=...` → ギルドドメイン上でCookie発行 → ダッシュボードへ
- セッションはギルドスコープ付きHMACトークン (ドメインごとに独立したCookie)
- 旧パスワードログイン (`ADMIN_PASSWORD_HASH`) は既定ギルドのフォールバックとして当面維持

## 実装フェーズ

| # | 内容 | 状態 |
|---|---|---|
| 1 | DB + shared: マイグレーション006〜008、ランキングクエリ・コンポーネントのギルド対応 | ✅ 完了 |
| 2 | Bot: 全ギルド同期・収集・ランキング・発言王ロール、`/setup` コマンド | ✅ 完了 |
| 3 | バックエンド: Hostヘッダーによるギルド解決、全ルートのguildフィルタ、キャッシュキー、display_config移行 | ✅ 完了 |
| 4 | フロントエンド: 相対パス化、Host解決ヘルパー、`ymkw.top` 脱ハードコード、k3s用Dockerfile | 未 |
| 5 | Discord OAuth: 中央コールバック + ギルドスコープセッション | 未 |
| 6 | インフラ (vpsリポジトリ): k3s manifests、ワイルドカード証明書、Nginx stream SNI分岐 + Caddy | 未 |
| 7 | ドメイン登録フロー: `/setup subdomain` (招待コード)、失効チェッカー、`/setup domain` + ask エンドポイント | 未 |

## デプロイ順序と移行

1. マイグレーション適用 (`cd db && bun run migrate`) → アプリのデプロイ前に必ず実行
2. Bot → バックエンド → フロントエンドの順で更新
3. `ymkw.top` はWorkers (現行) とk3s (新) を並行稼働でき、DNS切り替えで移行する。Workersの `routes` 解除をもって引退
4. `api.ymkw.top` は過渡期に既定ギルドの直接APIとして維持し、同一オリジン化完了後に整理
