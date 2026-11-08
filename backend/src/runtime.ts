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
  /** XFFから信頼エッジのホップを末尾から剥がした直近の非信頼エントリ。全て信頼ホップなら "unknown" */
  peerIp: string;
  /** 末尾から少なくとも1つの信頼エッジホップを剥がせたか */
  trustedPeer: boolean;
}

/** Next.jsマウント経由のトラフィックで、XFF直近ピアとして信頼できるエッジプロキシのIP */
export const TRUSTED_EDGE_PROXY_IPS = ["10.77.0.1"];

/**
 * マウントされたHonoに渡すピア情報をXFFチェーンから決める。
 * - 末尾から信頼エッジのホップ (VPS Nginx/CaddyのWGアドレス) を剥がし、
 *   直近の非信頼エントリを実クライアント候補として返す。これにより中継より前の
 *   偽装XFFは信用されない (レートリミットID偽装の対策)。
 * - 全て信頼ホップなら内部リクエスト (peerIp="unknown", trustedPeer=true)。
 * - 末尾が信頼ホップでない (LANからTraefik直叩き等) は末尾要素を実ピアとし、
 *   CFヘッダーは信頼しない。
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
  if (entries.length === 0) return { peerIp: "unknown", trustedPeer: false };
  const trusted = new Set(Array.from(trustedEdgeIps));
  let index = entries.length - 1;
  let trustedPeer = false;
  while (index >= 0 && trusted.has(entries[index])) {
    trustedPeer = true;
    index -= 1;
  }
  if (index < 0) return { peerIp: "unknown", trustedPeer: true };
  return { peerIp: entries[index], trustedPeer };
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
