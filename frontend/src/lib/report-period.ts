export function latestPublishedReportPath(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const previous = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - 1, 1));
  return `/month/${previous.getUTCFullYear()}/${previous.getUTCMonth() + 1}`;
}
