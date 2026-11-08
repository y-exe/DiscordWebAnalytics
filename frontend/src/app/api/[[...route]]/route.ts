import {
  deriveMountedRequestEnv,
  getBackendRuntime,
  stripApiPrefix,
} from "../../../../../backend/src/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HonoバックエンドをNext.jsにマウントする (同一オリジン運用)。
 * /api/* は同一プロセスで処理され、プレフィックスは剥がしてHonoルートへ届く。
 * エッジ (Caddy) は全トラフィックをこのコンテナへ投げるのみでよい。
 */

// ピアが信頼できるエッジプロキシのIP群 (既定: VPS Nginx/Caddy のWGアドレス)
const trustedEdgeIps = (process.env.TRUSTED_EDGE_PROXY_IPS || "10.77.0.1").split(",");

async function handler(request: Request): Promise<Response> {
  const { app } = await getBackendRuntime();
  return app.fetch(stripApiPrefix(request), deriveMountedRequestEnv(request, trustedEdgeIps));
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
