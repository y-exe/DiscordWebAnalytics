# マルチサーバー (SaaS型マルチテナント) 対応設計

## 目標

- 1つのBot・1つのDBで複数のDiscordサーバーへ対応する (公開Bot化を視野)
- 各ギルドは自分のドメイン、または無料サブドメイン `〇〇.yexe.top` でダッシュボードを開ける
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
- **APIはHonoのままNext.jsプロセスへマウントし、1コンテナに統合する** (2026-11-08決定)
  - `frontend/src/app/api/[[...route]]/route.ts` が `backend/src/api.ts` の `createApp()` を呼ぶ。Honoのコード・テスト・セキュリティ実装は無変更
  - エッジの `/api/*` 振り分けと `ymkw-backend` Deployment は不要になる (切り替え時に引退)
  - Workers移行期の `cf:build` は `bun:sqlite` を `frontend/stubs/bun-sqlite.cjs` へ外部化 (externals差し替え) して通す。Workers上では `/api/*` がrewritesで転送されるためマウントルートは実行されない
- **ギルド解決はHostヘッダーで行う** (独自ヘッダーは使わない)
  - DNSでしか作れないため偽装不可。エッジ (Caddy/Nginx) がHostを保持したままバックエンドへ転送する
- 本番インフラの正本は `vps` リポジトリ (`yexeserver:~/vps`)。トポロジは VPS Nginx (TLSエッジ) → WireGuard → k3s Traefik → アプリ

```
テナントドメイン / analytics.ymkw.top
        │
VPS: Nginx (stream SNI分岐 / 後述フェーズ6)
        ├─ 既存ホスト名 (api.ymkw.top等) → 従来どおりNginxのHTTPS処理
        └─ マルチテナント系 (*.yexe.top + 登録済み独自ドメイン) → Caddy (on-demand TLS)
                │ WireGuard (10.77.0.2:80, Host保持)
        k3s Traefik
                └─ /**  (SSR + /api/* Honoマウント) → ymkw-frontend (統合コンテナ)

ymkw.top (案内ホームページ)
        └─ Cloudflare Pages/Workers: home/ 静的サイト (ダッシュボードを含まない)
                └─ リンク先は analytics.ymkw.top
```

- **ymkw.topとダッシュボードは分離**されている。ymkw.topは案内ホームページ専用 (`home/` 静的サイトをCloudflare Pages/Workersで配信) で、ダッシュボードは `analytics.ymkw.top` および各ギルドのドメインで提供する
- ダッシュボードのルート `/` は `/month/latest` へリダイレクトする (案内はymkw.topの役割)

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

- ブラウザからのAPI呼び出しは **相対パス `/api/...`**。エッジが `/api/*` のプレフィックスを剥がしてバックエンドへ転送する (Next.jsを経由しないためSSRコンテナの負担にならない)
- SSR (サーバーコンポーネント) はクラスター内のバックエンドService URLを直接呼ぶ (`API_URL` 環境変数、プレフィックスなし)
- バックエンドは **Hostヘッダーでギルドを解決**する:
  1. `guild_domains` / `guilds` ルックアップ (キャッシュ付き)。未登録Hostは404
  2. 過渡期の `api.ymkw.top` は既定ギルドにフォールバック (移行完了後に廃止)
- **代表ドメイン**: `guild_domains.is_primary` が立つドメインをダッシュボードの代表URL (ランキングメッセージのボタン等の外部リンク先) に使う。メインギルドは `analytics.ymkw.top` が代表 (`ymkw.top` は案内サイトのため除外)
- ギルド別設定 (display_config, 除外ch) はバックエンドがキャッシュ付きでロード
- キャッシュキーに guildId を含める。ウォームループは「ドメイン設定のあるアクティブギルド」をループ
- `allowedOrigins` は同一オリジン化により縮小 (過渡期はymkw.top系を維持)

### 統合コンテナ (Honoマウント)

- バックエンド配線は `backend/src/runtime.ts` (`createBackendRuntime()`) に集約: loadConfig → pgプール → ログイン制限初期化 → SafeDiskCache → `createApp()`。プロセス内シングルトンで再構築しない
- `backend/src/main.ts` (Bun.serve) は過渡期の単独起動用として無変更のまま残す。k3s移行完了後に削除してよい
- SSRは `API_URL=http://127.0.0.1:4321/api` (セルフループバック、`/api` プレフィックス付き) でAPIを呼ぶ。`x-forwarded-host` によりギルド解決は元ページのHostで行われる
- `peerIp` はNextのroute handlerではソケットIPが取得できないため **X-Forwarded-For の末尾** (直近プロキシが見た直接ピア) を渡す。DNS-only独自ドメイン経由のレート制限品位の整理はフェーズ6 (エッジ構築時) に併せて実施
- ウォームループは `frontend/src/instrumentation.ts` が同一オリジン運用 (`NEXT_PUBLIC_SAME_ORIGIN=true`) かつnodejsランタイムのときに起動
- 統合コンテナには `DB_DSN` / `API_SECRET` / `ADMIN_SESSION_SECRET` / `ADMIN_PASSWORD_HASH` をk8s Secret等で与える (`backend/.env` は存在しないためprocess.envで読む)
- next.config: `BUILD_STANDALONE=true` 時は `output: standalone` かつ `outputFileTracingRoot` = monorepoルート (standaloneに `frontend/server.js` とトレースされた `backend/` が並ぶ)。WorkersビルドはOpenNextがアプリ相対レイアウトを前提とするためアプリ配下に固定

### 負荷対策

- **公開済み月のページ・APIレスポンスは不変データ** → `s-maxage` / Next.js fetch cache で全面キャッシュ
- 当月 (未公開) のみSSR/DBクエリが走る。Bot起動時のウォームループで当月分を温める
- 統合コンテナ (SSR + API + SQLiteディスクキャッシュ) のメモリ目安は 500〜800MB。k3sの `apps` ネームスペースに追加 (NetworkPolicyのDB許可リストは `ymkw-frontend` を対象に更新)
- SSRからのAPIセルフ呼び出しはループバック経由でバックエンドのレート制限バケットを共有する (現行のPod単位共有と同品位)

## サブドメイン (フェーズ7)

- **トポロジーの注意**: `*.yexe.top` がテナント名前空間の本体。`analytics.ymkw.top` は既定ギルドにBotで設定されたドメインの一つに過ぎない (guild_domains レコード)。エッジの本体は VPS Nginx SNI分岐 → Caddy
- **実装済み (7a)**: マイグレーション011 (source/invite_code/is_active)、`/internal/caddy-ask`、`/setup subdomain [code]` (コード指定時はRESTで招待の実在・归属を検証 / 未指定時はバニティURL優先・自動発行)、`/setup domain` (DNSがVPS IPを指すか検証)、失効チェッカー (Botが6時間ごとに招待を確認し無効化)。ベースドメインは `SUBDOMAIN_BASE_DOMAIN` 環境変数で変更可能 (既定 yexe.top)
- ベースドメイン: `yexe.top` (専用に取得した1階層ドメイン。ワイルドカードDNS `*.yexe.top` → VPS IP、DNS-only)
- コードの決定 (`/setup subdomain [code]`):
  1. 引数指定があればそのコード (`GET /invites/{code}` で実在・自ギルド归属を検証してから紐付け)
  2. 無指定ならギルドのバニティURL (カスタム招待) を優先
  3. バニティも無ければBotが無期限招待を発行し、そのコードを使う
- 文字種は小文字英数字とハイフンに正規化 (大文字・`_` はDNS/証明書で問題が出るため)。未対応文字は拒否して代替を提示
- **失効チェック**: Botが6時間ごとに `GET /invites/{code}` を確認 → 404 または別ギルドの招待になっていたら `guild_domains` を無効化
- 失効コードは別サーバーが再取得できる場合があるが、再紐付けは必ず当該ギルドの `/setup` 実行 (管理者承認) を要求するため、なりすましは発生しない
- 証明書: Caddyの **on-demand TLS** でギルドサブドメインごとに自動発行 (TLS-ALPN/HTTP-01、askエンドポイントで紐付け検証済みドメインのみ発行許可)。LEの発行上限は登録ドメイン単位なので `yexe.top` は既存の `yexe.xyz` と予算が独立。オンボーディング急増時の保険として `*.yexe.top` ワイルドカード1枚のDNS-01事前発行 (yexe.topゾーンのCloudflare APIトークン) も可能
- apex (`yexe.top`) はテナント名前空間に含めない。SNI分岐では `*.yexe.top` のみCaddyへ渡し、apexは従来どおりNginx側 (デフォルトサーバ) に残す。将来別用途に使う場合の証明書発行はその時点で別途決める

### ベースドメインの証明書トレードオフ (決定済み)

- 専用1階層ドメイン `yexe.top` を取得済み。**DNS-only + Caddy on-demand TLS を採用**する (無料・既存サイトのcloudflare-only保護は維持。マルチテナントvhostのみVPS直接TLS終端)
- 代替案 (Cloudflareプロキシ): 1階層ドメインなので Universal SSL の無料ワイルドカードでエッジTLSは成立する (2階層ワイルドカード時に必要だった Total TLS / ACM $10/月 は不要)。ただしorigin側にもワイルドカード証明書 (Origin CA または LE DNS-01) が別途必要で、失効ギルドのサブドメインもDNSで解決し続けるため無効化がアプリ層 (404) 側になる。将来切り替えたくなったら再検討

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
| 4 | フロントエンド: 相対パス化、Host解決ヘルパー、`ymkw.top` 脱ハードコード、k3s用Dockerfile | ✅ 完了 |
| 4.5 | ホームページ分離: `home/` 静的サイト (Cloudflare配信)、ダッシュボード `/` を `/month/latest` へリダイレクト、`analytics.ymkw.top` 登録 (009) | ✅ 完了 |
| 4.6 | API統合: HonoをNextにマウント (`/api/[[...route]]`)、`backend/src/runtime.ts`、Workersビルドのbun:sqliteスタブ、standalone次第で1コンテナ化 | ✅ 完了 |
| 4.7 | UI全面刷新: DeepSeek風デザインシステム (ライト/ダーク)、サマリー/チャンネル/メンバー/比較/統計の5ページ構成、Discord装飾表示 (タグ/ネームプレート/装飾/ブースト)、メンバー・チャンネル詳細、カード並べ替え | ✅ 完了 |
| 4.8 | ホームページ独立リポジトリ化: `y-exe/ymkw.top` (Vue 3 + Vite) へ切り出し、Cloudflare Pagesで配信 | ✅ 完了 |
| 5 | Discord OAuth: 中央コールバック + ギルドスコープセッション | 保留 |
| 6a | インフラ: k3s manifests (Deployment/Ingress/SOPS secret/NetworkPolicy)、統合コンテナ本番デプロイ、Traefik経由SSR+API検証 | ✅ 完了 |
| 6b | インフラ: VPS Nginx stream SNI分岐 + Caddy (on-demand TLS) 導入 | 未 (DNS・証明書はCaddy依存) |
| 7a | ドメイン登録フローのコード: マイグレーション011 (source/invite_code/is_active)、`/internal/caddy-ask`、`/setup subdomain` (招待コード検証) ・ `/setup domain` (DNS確認) 、失効チェッカー (6時間ごと) | ✅ 完了 (本番反映済み) |
| 7b | Caddy側配線: askエンドポイント接続、`*.yexe.top` ワイルドカードDNS、Botコマンドの実運用 | 未 |

## デプロイ順序と移行

1. マイグレーション適用 (`cd db && bun run migrate`) → アプリのデプロイ前に必ず実行
2. Bot → バックエンド (`backend/src/main.ts`、従来どおり別Deployment) → フロントエンドの順で更新。k3s移行完了後は統合コンテナが両者を置き、`ymkw-backend` Deploymentと `main.ts` は引退
3. `ymkw.top` はWorkers (現行) とk3s (新) を並行稼働でき、DNS切り替えで移行する。Workersの `routes` 解除をもって引退
4. `api.ymkw.top` は過渡期に既定ギルドの直接APIとして維持し、同一オリジン化完了後に整理
