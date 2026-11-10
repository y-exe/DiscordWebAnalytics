import type { Context } from "hono";
import type { Pool } from "pg";
import type { AppConfig } from "./config";

export interface CacheLike {
  get(key: string): unknown;
  set(key: string, value: unknown, expire?: number): void;
  consumeLimit(key: string, limit: number, window: number): boolean;
}

export interface AppDeps {
  config: AppConfig;
  cache: CacheLike;
  getPool: () => Pool | null;
  consumeLoginLimits: (
    pool: Pool,
    clientKey: string,
    perClient: number,
    total: number,
    window: number,
  ) => Promise<boolean>;
  verifyAdminPassword: (password: string, hash: string) => Promise<boolean>;
  getPeerIp?: (c: Context) => string;
}

export type AppEnv = { Bindings: { peerIp?: string; trustedPeer?: boolean } };
