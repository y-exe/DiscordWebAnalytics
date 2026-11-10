/**
 * 月次レポートの公開ルール (JST基準)。
 * フロントエンド・バックエンド・Botで共有するためルートの shared/ に置く。
 * ルール: 現在月 (JST) は非公開、前月以前が公開済み。
 */

/** 最新の公開済み月レポートのパス (/month/YYYY/M) を返す */
export function latestPublishedReportPath(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const previous = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - 1, 1));
  return `/month/${previous.getUTCFullYear()}/${previous.getUTCMonth() + 1}`;
}

/** 指定月が公開済み (レポート閲覧可能) かどうか */
export function isPublishedReportMonth(year: number, month: number, now = new Date()): boolean {
  if (
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    return false;
  const [, , latestYear, latestMonth] = latestPublishedReportPath(now).split("/");
  return year * 12 + month <= Number(latestYear) * 12 + Number(latestMonth);
}
