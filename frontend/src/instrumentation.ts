/**
 * Next.jsサーバー起動時のフック (同一オリジン運用のみ)。
 * バックエンドのウォームループを起動し、公開済み月の累計キャッシュを温めておく。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PUBLIC_SAME_ORIGIN !== "true") return;
  try {
    const { getBackendRuntime } = await import("../../backend/src/runtime");
    const runtime = await getBackendRuntime();
    runtime.startWarmLoop();
  } catch (error) {
    console.error("backend warm loop failed to start:", error);
  }
}
