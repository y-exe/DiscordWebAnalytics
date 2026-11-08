import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import type { Pool } from "pg";
import { verifyAdminPassword } from "./adminAuth";
import { createApp, startWarmLoop, type AppDeps, type AppEnv } from "./api";
import { loadConfig, type AppConfig } from "./config";
import { createBackendPool } from "./db";
import { consumeLoginLimits, initializeLoginLimits } from "./loginLimits";
import { SafeDiskCache } from "./safeCache";

export interface BackendRuntime {
  app: Hono<AppEnv>;
  config: AppConfig;
  pool: Pool;
  startWarmLoop(): () => void;
  close(): Promise<void>;
}

/**
 * Next.jsの `/api/[[...route]]` に届いたリクエストをHono向けに変換する。
 * Honoのルートはプレフィックスなしパス (`/ranking` など) で定義されているため、
 * `/api` プレフィックスのみURLから剥がし、ヘッダー (x-forwarded-host等) は維持する。
 */
export function stripApiPrefix(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === "/api") {
    url.pathname = "/";
  } else if (url.pathname.startsWith("/api/")) {
    url.pathname = url.pathname.slice("/api".length);
  } else {
    return request;
  }
  return new Request(url.toString(), request);
}

export interface MountedRequestEnv {
  peerIp: string;
  trustedPeer: boolean;
}

/** Next.jsマウント経由のトラフィックで、XFF直近ピアとして信頼できるエッジプロキシのIP */
export const TRUSTED_EDGE_PROXY_IPS = ["10.77.0.1"];

/**
 * マウントされたHonoに渡すピア情報をXFFチェーンから決める。
 * - 直近ピア (末尾要素) が信頼エッジ (VPS Nginx/Caddy) なら、先頭要素を実クライアント
 *   クライアントとして信頼し、CF-Connecting-IPの使用を許可する (trustedPeer)。
 * - それ以外 (LANからTraefik直叩き等) は末尾要素を実ピアとし、CFヘッダーは信頼しない。
 * - XFFなし (セルフ呼び出し等) は unknown。CF由来の偽装XFFはTraefikが直接ピアを末尾に
 *   追加するため偽装不能。
 */
export function deriveMountedRequestEnv(
  request: Request,
  trustedEdgeIps: Iterable<string> = TRUSTED_EDGE_PROXY_IPS,
): MountedRequestEnv {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return { peerIp: "unknown", trustedPeer: false };
  const entries = forwarded
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const last = entries[entries.length - 1];
  if (last === undefined) return { peerIp: "unknown", trustedPeer: false };
  const trusted = Array.from(trustedEdgeIps).some((ip) => ip === last);
  return { peerIp: trusted ? (entries[0] ?? last) : last, trustedPeer: trusted };
}

let runtimePromise: Promise<BackendRuntime> | null = null;

/**
 * マウント利用向けのシングルトン取得 (プロセス内で一度だけ構築する)。
 * DB等の一時的な障害で初期化に失敗しても、次のリクエストで再試行できるようにする。
 */
export function getBackendRuntime(): Promise<BackendRuntime> {
  if (!runtimePromise) {
    runtimePromise = createBackendRuntime().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

/**
 * Honoアプリと依存 (DBプール・キャッシュ・ログイン制限) を構築する。
 * Next.jsへのマウント用。単独起動 (src/main.ts) は従来どおり自身で配線する。
 */
export async function createBackendRuntime(
  options: { cacheDir?: string } = {},
): Promise<BackendRuntime> {
  const config = await loadConfig();
  const pool = createBackendPool(config.dbDsn);
  await pool.query("SELECT 1");
  await initializeLoginLimits(pool);

  const cache = new SafeDiskCache(
    options.cacheDir ?? path.join(os.tmpdir(), "ymkw_api_diskcache_v14"),
    config.cacheSizeLimitBytes,
  );

  const deps: AppDeps = {
    config,
    cache,
    getPool: () => pool,
    consumeLoginLimits,
    verifyAdminPassword,
  };
  const app = createApp(deps);

  return {
    app,
    config,
    pool,
    startWarmLoop: () => startWarmLoop(app),
    close: async () => {
      await pool.end().catch(() => {});
      cache.close();
    },
  };
}
