import { latestPublishedReportPath } from "@/lib/report-period";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  // リダイレクト先は相対パスで返す (スキーマ/ホスト依存を排除)。
  // Next standalone配下ではHostがプロキシチェーンによって変化するため、
  // 絶対URLを組み立てるとスキームやホストが壊れる。
  const incoming = new URL(request.url);
  const target = `${latestPublishedReportPath()}${incoming.search}`;
  return new Response(null, {
    status: 307,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
}
