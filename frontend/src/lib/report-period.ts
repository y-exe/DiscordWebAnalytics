export function latestPublishedReportPath(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const previous = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - 1, 1));
  return `/month/${previous.getUTCFullYear()}/${previous.getUTCMonth() + 1}`;
}

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
