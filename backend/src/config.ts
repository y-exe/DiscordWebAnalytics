import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns/promises";
import dotenv from "dotenv";
import ipaddr from "ipaddr.js";

export class ConfigError extends Error {}

export type CidrRange = [ipaddr.IPv4 | ipaddr.IPv6, number];

const BASE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALLOWED_ORIGINS = [
  "https://ymkw.top",
  "https://www.ymkw.top",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
];

// これらのHostはギルドDomainsが未登録でも既定ギルドへフォールバックする (過渡期互換)
const DEFAULT_GUILD_HOSTS = ["api.ymkw.top", "localhost", "127.0.0.1", "::1", "ymkw-backend"];

export interface AppConfig {
  guildId: string;
  defaultGuildHosts: Set<string>;
  dbDsn: string;
  apiSecret: string;
  adminSessionSecret: string;
  adminPasswordHash: string;
  enableApiDocs: boolean;
  allowedOrigins: string[];
  rateLimitWindow: number;
  maxRequests: number;
  botMaxRequests: number;
  dbRateLimitWindow: number;
  dbMaxRequests: number;
  dbBotMaxRequests: number;
  blockDuration: number;
  trustCloudflareProxy: boolean;
  cloudflareTrustedProxyCidrs: CidrRange[];
  adminLoginGlobalLimit: number;
  cacheSizeLimitBytes: number;
}

export interface ConfigLoadOptions {
  inContainer?: boolean;
  canResolveHostDockerInternal?: () => Promise<boolean>;
}

function intEnv(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

async function defaultCanResolveHostDockerInternal(): Promise<boolean> {
  try {
    await dns.lookup("host.docker.internal");
    return true;
  } catch {
    return false;
  }
}

export async function adjustDbDsn(dsn: string, options: ConfigLoadOptions = {}): Promise<string> {
  const inContainer = options.inContainer ?? fs.existsSync("/.dockerenv");
  const localDbPort = process.env.LOCAL_DB_PORT ?? "5433";
  const canResolve = options.canResolveHostDockerInternal ?? defaultCanResolveHostDockerInternal;

  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    return dsn;
  }

  let host = parsed.hostname.replace(/^\[|\]$/g, "");
  let port = parsed.port || null;

  if (!inContainer) {
    if (host === "postgres-db") {
      host = "localhost";
      port = localDbPort;
    } else if (host === "localhost") {
      host = "127.0.0.1";
    } else {
      return dsn;
    }
  } else if (host === "localhost" || host === "127.0.0.1") {
    if (await canResolve()) {
      host = "host.docker.internal";
    } else {
      console.warn("Container database host is not resolvable. Keeping original DSN.");
      return dsn;
    }
  } else {
    return dsn;
  }

  parsed.hostname = host;
  if (port) parsed.port = port;
  return parsed.toString();
}

export function parseTrustedProxyCidrs(rawValue: string): CidrRange[] {
  const networks: CidrRange[] = [];
  for (const part of rawValue.split(",")) {
    const cidr = part.trim();
    if (!cidr) continue;
    let parsed: CidrRange | null = null;
    try {
      parsed = ipaddr.parseCIDR(cidr) as CidrRange;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      throw new ConfigError(`Invalid CIDR in CLOUDFLARE_TRUSTED_PROXY_CIDRS: ${cidr}`);
    }
    networks.push(parsed);
  }
  return networks;
}

export function isTrustedProxy(peerIp: string, cidrs: CidrRange[]): boolean {
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    address = ipaddr.parse(peerIp);
  } catch {
    return false;
  }
  return cidrs.some((range) => {
    try {
      return address.match(range);
    } catch {
      return false;
    }
  });
}

export function getClientIp(
  peerIp: string,
  cfHeader: string | undefined,
  trustCloudflareProxy: boolean,
  cidrs: CidrRange[],
  trustedPeer = false,
): string {
  // CF-Connecting-IPは「直近の非信頼ホップがCloudflareエッジ」の場合のみ採用する。
  // Caddy直達 (CF経由でない) トラフィックではpeerIpが実クライアント自身になるため、
  // 攻撃者がCF-Connecting-IPを偽装しても採用されない。
  if (trustCloudflareProxy && isTrustedProxy(peerIp, cidrs)) {
    const cloudflareIp = (cfHeader ?? "").trim();
    if (cloudflareIp) {
      try {
        return ipaddr.parse(cloudflareIp).toString();
      } catch {
        console.warn(`Ignored invalid CF-Connecting-IP from trusted proxy ${peerIp}`);
      }
    }
  }
  return peerIp;
}

function readEnvFile(filePath: string): Record<string, string> {
  try {
    return dotenv.parse(fs.readFileSync(filePath));
  } catch {
    return {};
  }
}

export async function loadConfig(options: ConfigLoadOptions = {}): Promise<AppConfig> {
  dotenv.config();
  const localEnv = readEnvFile(path.join(BASE_DIR, ".env"));
  const applicationSecret = (name: string): string =>
    (localEnv[name] || process.env[name] || "").trim();

  let rawDsn = process.env.DB_DSN;
  if (!rawDsn) {
    const rootDir = path.dirname(BASE_DIR);
    const botEnvPath = fs.existsSync(path.join(rootDir, "Bot", ".env"))
      ? path.join(rootDir, "Bot", ".env")
      : path.join(rootDir, "bot", ".env");
    const botEnv = readEnvFile(botEnvPath);
    for (const [key, value] of Object.entries(botEnv)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    rawDsn = process.env.DB_DSN;
  }

  const apiSecret = applicationSecret("API_SECRET");
  const adminSessionSecret = applicationSecret("ADMIN_SESSION_SECRET");
  const adminPasswordHash = applicationSecret("ADMIN_PASSWORD_HASH");

  if (!rawDsn) throw new ConfigError("ERROR: DB_DSN not found.");
  if (apiSecret.length < 32) {
    throw new ConfigError("ERROR: API_SECRET must be set to at least 32 characters.");
  }
  if (adminSessionSecret.length < 32) {
    throw new ConfigError("ERROR: ADMIN_SESSION_SECRET must be set to at least 32 characters.");
  }
  if (!/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(adminPasswordHash)) {
    throw new ConfigError(
      "ERROR: ADMIN_PASSWORD_HASH must be a PBKDF2-SHA256 hash generated by scripts/generate_admin_password_hash.",
    );
  }

  const adminLoginGlobalLimit = intEnv(process.env.ADMIN_LOGIN_GLOBAL_LIMIT, 20);
  if (adminLoginGlobalLimit < 1) {
    throw new ConfigError("ADMIN_LOGIN_GLOBAL_LIMIT must be positive.");
  }

  let cloudflareTrustedProxyCidrs: CidrRange[];
  try {
    cloudflareTrustedProxyCidrs = parseTrustedProxyCidrs(
      process.env.CLOUDFLARE_TRUSTED_PROXY_CIDRS ?? "",
    );
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(String(error));
  }

  const trustCloudflareProxy =
    (process.env.TRUST_CLOUDFLARE_PROXY ?? "false").toLowerCase() === "true";
  if (trustCloudflareProxy && cloudflareTrustedProxyCidrs.length === 0) {
    console.warn(
      "TRUST_CLOUDFLARE_PROXY is enabled without CLOUDFLARE_TRUSTED_PROXY_CIDRS; " +
        "CF-Connecting-IP will not be trusted.",
    );
  }

  return {
    guildId: (localEnv.GUILD_ID || process.env.GUILD_ID || "").trim(),
    defaultGuildHosts: new Set(
      (process.env.DEFAULT_GUILD_HOSTS || DEFAULT_GUILD_HOSTS.join(","))
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0),
    ),
    dbDsn: await adjustDbDsn(rawDsn, options),
    apiSecret,
    adminSessionSecret,
    adminPasswordHash,
    enableApiDocs: (process.env.ENABLE_API_DOCS ?? "false").toLowerCase() === "true",
    allowedOrigins: ALLOWED_ORIGINS,
    rateLimitWindow: intEnv(process.env.RATE_LIMIT_WINDOW, 10),
    maxRequests: intEnv(process.env.RATE_LIMIT_MAX_REQUESTS, 180),
    botMaxRequests: intEnv(process.env.RATE_LIMIT_BOT_MAX_REQUESTS, 900),
    dbRateLimitWindow: intEnv(process.env.DB_RATE_LIMIT_WINDOW, 60),
    dbMaxRequests: intEnv(process.env.DB_RATE_LIMIT_MAX_REQUESTS, 135),
    dbBotMaxRequests: intEnv(process.env.DB_RATE_LIMIT_BOT_MAX_REQUESTS, 540),
    blockDuration: intEnv(process.env.RATE_LIMIT_BLOCK_DURATION, 600),
    trustCloudflareProxy,
    cloudflareTrustedProxyCidrs,
    adminLoginGlobalLimit,
    cacheSizeLimitBytes: intEnv(process.env.CACHE_SIZE_LIMIT_BYTES, 256 * 1024 * 1024),
  };
}
