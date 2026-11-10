# 初期設定

[目次](../README.md)

これらのコマンドはサーバー管理権限を持つメンバーのみ実行できます。

## ギルド設定 — `/setup`

| コマンド | 対応 |
| --- | --- |
| `/setup announce channel:` | 月間ランキングの告知先チャンネルを設定・解除 |
| `/setup king-role role:` | 月間発言王ロールを設定・解除 |
| `/setup exclude add channel:` | ランキング除外チャンネルに追加 |
| `/setup exclude remove channel:` | 除外チャンネルを取り消す |
| `/setup exclude clear` | 除外設定をすべて消す |
| `/setup exclude list` | 除外チャンネルの一覧を表示 |
| `/setup show` | 現在の設定を表示 |

設定は `guilds` テーブルに保存され、`GUILD_ID`・`KING_ROLE_ID`・`ANNOUNCE_CHANNEL_ID`・`EXCLUDED_CHANNEL_IDS` の環境変数は既定ギルドのシード値です。起動時に未設定の列だけを埋め、`/setup` による設定を優先します。

## 月間発言王ロール

- 対象は日本時間の前月。Bot起動時と60秒ごとの確認で、発言王ロールを全ギルドへ更新します。
- 完了した月は `monthly_role_runs` に記録され、重複実行を防ぎます。
- 更新失敗時は完了扱いにせず再試行します。Botには対象ロールより上のロールと「ロールの管理」権限が必要です。

## サブドメイン・独自ドメイン

| コマンド | 内容 |
| --- | --- |
| `/setup subdomain code:` | `*.yexe.top` のサブドメインを設定。`code:` は使う招待コード (ケースセンシティブ、未指定でサーバーID) |
| `/setup domain domain:` | 独自ドメインを設定。DNSがVPS IP (`SERVER_PUBLIC_IP`) を向いている必要があります |

- 登録済み (かつ有効) ドメインだけがCaddyのon-demand TLSで証明書を発行されます (`/api/internal/caddy-ask` が `guild_domains` テーブルで判定)。
- DNSをVPSに向けてからダッシュボードへアクセスすると、証明書発行が走ります。発行に失敗する場合はDNS伝播と `guild_domains` の有効フラグを確認します。
- 無料サブドメインは失効チェッカー (6時間ごと) が管理します。基準ドメインは `SUBDOMAIN_BASE_DOMAIN` (既定: `yexe.top`)。
- apex (`yexe.top` 自体) はテナント名前空間の対象外です。

## Bot コマンド

| コマンド | 内容 |
| --- | --- |
| `/month` | 【管理者用】指定した月のランキングを手動送信 |
| `/all` | 【管理者用】全期間のランキングを表示 |

月間ランキングは毎月、告知先チャンネルへ自動投稿されます。投稿に含まれるリンクはそのサーバーのダッシュボードURL (登録ドメイン優先) です。
