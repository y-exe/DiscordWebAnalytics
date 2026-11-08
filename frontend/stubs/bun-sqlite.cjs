// Workersビルド (next build --webpack) 用の bun:sqlite スタブ。
// バックエンドの SafeDiskCache はBunランタイム専用だが、Workers では /api/* が
// rewrites で外部APIへ転送されるためマウントルートは実行されない。
// バンドルと require 解決のみが目的のため、実装は完全に空でよい。
module.exports = {
  Database: class Database {},
};
