# ymkw.top 案内ホームページ (静的サイト)

ymkw.top のルートで配信する案内ページ。ダッシュボード本体は `analytics.ymkw.top` および各ギルドのカスタムドメイン (k3s上のNext.js) で提供され、このディレクトリはダッシュボードに含まれない。

## 構成

- `index.html` — ダッシュボードアプリのルートHTMLをスナップショット化し、Next.js配信物への依存 (chunks/hydration) を排除したもの。CSSはインライン済み
- `home-scene/` — トップの3Dシーン (three.js / importmap経由でCDNからロード)
- `favicon.ico` / `apple-touch-icon.png` / `ranking.webp` — アイコンとOGP画像
- `_headers` — Cloudflare Pages/Workers でのセキュリティヘッダー

## 再生成

ダッシュボードのホームデザインを変更した場合は作り直す:

1. ダッシュボードアプリを起動して `/` のHTMLを取得し `home/index.html.raw` に保存する
2. `bun scripts/build-static-home.mjs` を実行 (assetsのコピーは手動)

## 配備

- **Cloudflare Pages**: このディレクトリをビルド出力ディレクトリとして指定 (`wrangler pages deploy .`)
- **Cloudflare Workers (Assets)**: `wrangler.toml` に `assets.directory = "."` を設定して `wrangler deploy`

リンク先は `analytics.ymkw.top` (ダッシュボード) 向けに書き換え済み。
