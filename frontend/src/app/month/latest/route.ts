export const dynamic = "force-dynamic";

export function GET(request: Request) {
  // 旧ショートカット (/month/latest) をルートへ集約する。
  // ルート (/) が最新公開月を既定表示するためリダイレクト先は / でよい。
  const incoming = new URL(request.url);
  return new Response(null, {
    status: 307,
    headers: { Location: `/${incoming.search}`, "Cache-Control": "no-store" },
  });
}
