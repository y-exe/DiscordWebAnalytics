# 開発とテスト

[目次](../README.md)

## 日常コマンド

```bash
bun run bootstrap   # 初期インストール (Bun + npm/Docker用ロックファイルの更新含む)
bun run dev         # Bot・backend・frontend を同時起動
bun run check      # lint (Biome) ・型検査・テスト
```

| コマンド | 内容 |
| --- | --- |
| `bun run lint` | Biome |
| `bun run typecheck` | `tsc --noEmit` の統合 (turbo) |
| `bun run test` | Bun test (backend・botなど) |
| `bun run build` | フロントエンドのビルド |
| `bun run format` / `format:check` | コード整形 |

コミット前にやること: 使い捨てコード・不要ログ・不要コメントを消し、`bun run check` を通してからpushする。

## テストの構成

- `backend/test/` — runtime・XFF信頼モデル・APIセキュリティのテスト
- `Bot/` — 同期・ロール更新のロジックテスト
- `frontend/` — 共有コンポーネントの単体テスト

DBに依存するテストは接続文字列の `LOCAL_DB_PORT` (既定 `5433`) フォールバックや、PGliteを使ったランタイムを利用します。詳細は `backend/test/*.test.ts` 内のコメントを参照。

## マルチテナントの実装メモ

- ギルド解決はHostヘッダー (または `x-forwarded-host`)。`backend/src/runtime.ts` の `deriveMountedRequestEnv` でXFF以外からの信頼を決定します。
- キャッシュキーにギルドを含めます。実装と進捗は `docs/multi-guild.md` のフェーズ表を参照してください。
- スキーマを変更する場合: `db/migrations/` に新しい番号のSQLを追加します。既存ファイルは編集しない。`CREATE INDEX CONCURRENTLY` などトランザクション外SQLは `-- migrate: no-transaction` を指定し、1ファイル1ステートメントにします。

## 管理者API

管理系のルートは `ADMIN_SESSION_SECRET` によるセッション検証 (`backend/src/adminAuth.ts`) を通ります。ログインはグローバル上限 (レート制限) 付きです。

## リリース

1. `bun run check` 通過
2. `main` push → GitHub Actionsで ghcr publish → Image Updater反映
3. k3sのrolloutを確認 ([デプロイ](../operations/deploy.md))
