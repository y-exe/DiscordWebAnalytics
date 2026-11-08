/** k8sプローブ用の軽量ヘルスチェック。バックエンドランタイム (DB) には依存しない。 */
export function GET(): Response {
  return new Response("ok", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
