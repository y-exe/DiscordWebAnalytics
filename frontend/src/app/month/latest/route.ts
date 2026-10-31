import { latestPublishedReportPath } from "@/lib/report-period";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const source = new URL(request.url);
  const target = new URL(latestPublishedReportPath(), source);
  target.search = source.search;
  return new Response(null, {
    status: 307,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  });
}
