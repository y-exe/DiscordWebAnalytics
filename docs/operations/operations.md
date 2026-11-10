# 運用・障害調査

[目次](../README.md)

## 監視

VPSのUptime Kuma (`127.0.0.1:3001`) に2026-11-10に追加した監視。

| Monitor | 種別 | 対象と期待値 |
| --- | --- | --- |
| analytics-api | HTTP | `https://analytics.ymkw.top/api/health` → 200 |
| analytics-frontend | HTTP | `https://analytics.ymkw.top/` → 200 |

analytics.ymkw.topはDNS-only (Cloudflareを経由しない) のため、Kumaからオリジンを直接確認します。既存の `ymkwtop-backend` モニタ (`https://api.ymkw.top`) は統合コンテナのAPIを指しています。証明書はcertbotの自動更新で、dry-runによる検証が済んでいます。

## バックアップ

PostgreSQLのデータ (discord_logs custom dumpとpg_dumpall) は、vpsリポジトリの `scripts/backup-app-data.sh` がage暗号化してGoogle Driveへ保存します。世代は7件。詳細はvpsリポジトリの `docs/backups.md` を参照してください。

## 証明書

| ホスト | 発行方式 |
| --- | --- |
| analytics.ymkw.top | certbot (authenticator: nginx、HTTP-01) |
| api.ymkw.top ほか既存ホスト | 同上 (CloudflareのOrigin証明書として使用) |
| テナントドメイン (`*.yexe.top` と登録済み独自ドメイン) | Caddy on-demand TLS (VPS上 `127.0.0.1:8444`) |

要点を記録します。

- nginxのstream SNI分岐 (`127.0.0.1:8443` への既存ホスト、それ以外はCaddy) はvpsリポジトリの `configs/vps/nginx/nginx.conf` で管理。
- nginxのhttpサーバーブロックで `listen 443 ssl` を直接書かない (streamと衝突してreloadが必ず失敗する)。
- nginxのreloadが静かに失敗すると古い設定で動き続けるため、変更後はエラーログと挙動テストを必ずする。

## 障害事例と対処

### アバターの404

長期不在メンバーのプロフィール再取得が止まると、Discord CDNのアバターURLが陳腐化して404になります。

1. `guild_members.updated_at` を確認する。
2. 表示側はIDから派生したデフォルトアバターへフォールバックする実装済みです。
3. `refreshAvatars` (30分ごとに2000名ずつランダム再取得、約3.3時間で全員一周) のログを確認する。

### 古い数値が表示される

API応答は Cache-Control: `public max-age` (月次600秒・total`86400秒`) を付けています。フロントの `fetchAPI` は `cache: "no-store"` で取得するので、アプリ内の表示が古い場合はデプロイとキャッシュの両方を確認します。

### DB認証エラー (28P01)

1. 適用順序は `kubectl apply` (Secret) → `ALTER ROLE` → `rollout restart` の順。
2. 認証の実検証は `hostssl` の経路で行う (`127.0.0.1` とunix socketはpg_hbaのtrustのためパスワードを検証しない)。
3. K8s SecretとPostgresロールのパスワードが一致しているかを確認する。

## 観測のコマンド

```bash
sudo kubectl -n apps logs deployment/ymkw-bot --tail=100
sudo kubectl -n apps logs deployment/ymkw-frontend --tail=100
sudo kubectl -n apps get pods,events --sort-by=.lastTimestamp
```

外部からの最低ラインは `curl https://analytics.ymkw.top/api/health` が `ok` を返すことです。UIの確認は `/` と `/relation` の200です。
