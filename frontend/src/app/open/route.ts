import { NextResponse } from "next/server";

export function GET(request: Request) {
  // 相対Locationで返す (プロキシ背後でスキーマ/ホストが変わるため)
  const incoming = new URL(request.url);
  return new Response(null, {
    status: 301,
    headers: { Location: `/all${incoming.search}` },
  });
}
