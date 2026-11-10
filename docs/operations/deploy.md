# デプロイ

[目次](../README.md)

本番はk3s (Argo CD) で運用しています。マニフェストは別リポジトリ [y-exe/vps](https://github.com/y-exe/vps) の `apps/` にあります。

## デプロイ順序

1. マイグレーション (`cd db && bun run migrate`) — アプリの更新前に必ず実行
2. イメージのビルドとpush (GitHub Actions)
3. vpsリポジトリのマニフェスト更新 → Argoが自動同期 → Podのロールアウトを確認

## イメージ

GitHub Actions (`ghcr-publish.yml`) が `main` へのpushを受け、`bun run check` の後に `ghcr.io` へイメージをpushします。タグは `sha-<コミット短縮hash>` です。

| ジョブ | イメージ |
| --- | --- |
| build-and-push-frontend | 統合コンテナ (Next.js SSR + `/api` Honoマウント) |
| build-and-push-bot | 収集Bot |

コンテキストはリポジトリルートです (共有ソースを含めるため)。

## Secret

- SecretsはSOPS/age (`secrets/*.enc.yaml`、実体はvpsリポジトリ) で管理し、Argoの同期対象外のため手動applyします。
  ```bash
  # vpsリポジトリのルートから。復号内容を端末やファイルに出さない
  sudo SOPS_AGE_KEY_FILE=/root/.config/sops/age/keys.txt bash scripts/apply-secrets.sh
  ```
- 環境変数Secret (`ymkw-frontend-env`・`ymkw-bot-env`) を更新したらPodの再起動が必要です。
- Secretの値はログ・チャット・Issueに貼らないでください (SOPSの中身も同様)。`ymkw-backend-env` は統合コンテナ移行後に退役していますが、流出時の再発防止として内容の更新を継続します。

## ロールアウトとロールバック

```bash
sudo kubectl -n apps rollout status deployment/ymkw-frontend
sudo kubectl -n apps rollout status deployment/ymkw-bot
```

通常のロールバックはvpsリポジトリの `git revert` とpushです。DBスキーマのrevertは別途手順が必要です。

## URLと検証の既定

| URL | 想定 |
| --- | --- |
| `/` | 最新公開月の統計を直接描画 |
| `/month/{year}/{month}`・`/all`・`/month/latest` | クエリ形式 (`/?m=...`) へのリダイレクト |
| `/api/health` | APIの健康確認 (DB疎通込み、正常時は `ok` を返す) |
| `/healthz` | Next.jsネイティブルート (DB非依存、プローブ用) |

外部検証の最低ライン: 80→301、`/api/health`→200、`/relation`→200、`/?m=YYYY-MM`→200。
