export function GET() {
  // 相対Locationで返す (プロキシ背後でスキーマ/ホストが変わるため)
  return new Response(null, { status: 308, headers: { Location: "/" } });
}
