import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dns from 'node:dns/promises'
import dotenv from 'dotenv'
import ipaddr from 'ipaddr.js'

export class ConfigError extends Error {}

export type CidrRange = [ipaddr.IPv4 | ipaddr.IPv6, number]

const BASE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ALLOWED_ORIGINS = [
  'https://ymkw.top',
  'https://www.ymkw.top',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
]

const WHITELIST_CHANNEL_IDS = [
  '1355425464729993367',
  '1355073969199382530',
  '1357298745506791574',
  '1450890768255422595',
  '1373320764945858740',
  '1356324385983697098',
  '1355497603910865046',
  '1355552587394449589',
  '1371391700131647491',
  '1355546326657667150',
  '1399071027925094617',
  '1355810985356689547',
  '1360622424579899524',
  '1356237901645746348',
  '1406033558757314752',
  '1383029750166982656',
  '1355570062378930317',
  '1355546503048859840',
  '1361713489990779172',
]

const PRIVATE_CHAT_CHANNEL_ID = '-1'
const PRIVATE_CHAT_CATEGORY_IDS = [
  '1355470118003540048',
  '1356573392181919794',
  '1355760969187463378',
  '1355073969199382528',
  '1355438544273019022',
  '1356237701178982501',
  '1411004698944602187',
  '1508697019223375882',
  '1371108563384012922',
]
const BOTTOM_CHANNEL_CATEGORY_IDS = new Set(['1355760969187463378'])

export interface AppConfig {
  dbDsn: string
  apiSecret: string
  adminSessionSecret: string
  adminPasswordHash: string
  enableApiDocs: boolean
  allowedOrigins: string[]
  whitelistChannelIds: Set<string>
  privateChatChannelId: string
  privateChatCategoryIds: string[]
  bottomChannelCategoryIds: Set<string>
  rateLimitWindow: number
  maxRequests: number
  botMaxRequests: number
  dbRateLimitWindow: number
  dbMaxRequests: number
  dbBotMaxRequests: number
  blockDuration: number
  trustCloudflareProxy: boolean
  cloudflareTrustedProxyCidrs: CidrRange[]
  adminLoginGlobalLimit: number
  cacheSizeLimitBytes: number
}

export interface ConfigLoadOptions {
  /** /.dockerenv 判定の上書き (テスト用) */
  inContainer?: boolean
  /** host.docker.internal の名前解決可否の上書き (テスト用) */
  canResolveHostDockerInternal?: () => Promise<boolean>
}

function intEnv(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(value) ? value : fallback
}

async function defaultCanResolveHostDockerInternal(): Promise<boolean> {
  try {
    await dns.lookup('host.docker.internal')
    return true
  } catch {
    return false
  }
}

/**
 * 実行環境に応じてDB_DSNの接続先ホストを書き換える。
 * Python版 backend/main.py の adjust_db_dsn と同じ挙動。
 */
export async function adjustDbDsn(
  dsn: string,
  options: ConfigLoadOptions = {},
): Promise<string> {
  const inContainer = options.inContainer ?? fs.existsSync('/.dockerenv')
  const localDbPort = process.env.LOCAL_DB_PORT ?? '5433'
  const canResolve =
    options.canResolveHostDockerInternal ?? defaultCanResolveHostDockerInternal

  let parsed: URL
  try {
    parsed = new URL(dsn)
  } catch {
    return dsn
  }

  let host = parsed.hostname.replace(/^\[|\]$/g, '')
  let port = parsed.port || null

  if (!inContainer) {
    if (host === 'postgres-db') {
      host = 'localhost'
      port = localDbPort
    } else if (host === 'localhost') {
      host = '127.0.0.1'
    } else {
      return dsn
    }
  } else if (host === 'localhost' || host === '127.0.0.1') {
    if (await canResolve()) {
      host = 'host.docker.internal'
    } else {
      console.warn('Container database host is not resolvable. Keeping original DSN.')
      return dsn
    }
  } else {
    return dsn
  }

  parsed.hostname = host
  if (port) parsed.port = port
  return parsed.toString()
}

export function parseTrustedProxyCidrs(rawValue: string): CidrRange[] {
  const networks: CidrRange[] = []
  for (const part of rawValue.split(',')) {
    const cidr = part.trim()
    if (!cidr) continue
    let parsed: CidrRange | null = null
    try {
      parsed = ipaddr.parseCIDR(cidr) as CidrRange
    } catch {
      parsed = null
    }
    if (!parsed) {
      throw new ConfigError(`Invalid CIDR in CLOUDFLARE_TRUSTED_PROXY_CIDRS: ${cidr}`)
    }
    networks.push(parsed)
  }
  return networks
}

export function isTrustedProxy(peerIp: string, cidrs: CidrRange[]): boolean {
  let address: ipaddr.IPv4 | ipaddr.IPv6
  try {
    address = ipaddr.parse(peerIp)
  } catch {
    return false
  }
  return cidrs.some((range) => {
    try {
      return address.match(range)
    } catch {
      return false
    }
  })
}

/**
 * 実クライアントIPを判定する。信頼済みプロキシ経由の場合のみ
 * CF-Connecting-IP を採用する (Python版 get_client_ip 相当)。
 */
export function getClientIp(
  peerIp: string,
  cfHeader: string | undefined,
  trustCloudflareProxy: boolean,
  cidrs: CidrRange[],
): string {
  if (trustCloudflareProxy && isTrustedProxy(peerIp, cidrs)) {
    const cloudflareIp = (cfHeader ?? '').trim()
    if (cloudflareIp) {
      try {
        return ipaddr.parse(cloudflareIp).toString()
      } catch {
        console.warn(`Ignored invalid CF-Connecting-IP from trusted proxy ${peerIp}`)
      }
    }
  }
  return peerIp
}

function readEnvFile(filePath: string): Record<string, string> {
  try {
    return dotenv.parse(fs.readFileSync(filePath))
  } catch {
    return {}
  }
}

export async function loadConfig(options: ConfigLoadOptions = {}): Promise<AppConfig> {
  // カレントディレクトリの .env を環境変数に反映 (未設定キーのみ)
  dotenv.config()
  // backend/.env はファイル値を優先する (Python版 application_secret と同じ)
  const localEnv = readEnvFile(path.join(BASE_DIR, '.env'))
  const applicationSecret = (name: string): string =>
    (localEnv[name] || process.env[name] || '').trim()

  let rawDsn = process.env.DB_DSN
  if (!rawDsn) {
    const rootDir = path.dirname(BASE_DIR)
    const botEnvPath = fs.existsSync(path.join(rootDir, 'Bot', '.env'))
      ? path.join(rootDir, 'Bot', '.env')
      : path.join(rootDir, 'bot', '.env')
    const botEnv = readEnvFile(botEnvPath)
    for (const [key, value] of Object.entries(botEnv)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
    rawDsn = process.env.DB_DSN
  }

  const apiSecret = applicationSecret('API_SECRET')
  const adminSessionSecret = applicationSecret('ADMIN_SESSION_SECRET')
  const adminPasswordHash = applicationSecret('ADMIN_PASSWORD_HASH')

  if (!rawDsn) throw new ConfigError('ERROR: DB_DSN not found.')
  if (apiSecret.length < 32) {
    throw new ConfigError('ERROR: API_SECRET must be set to at least 32 characters.')
  }
  if (adminSessionSecret.length < 32) {
    throw new ConfigError('ERROR: ADMIN_SESSION_SECRET must be set to at least 32 characters.')
  }
  if (!/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(adminPasswordHash)) {
    throw new ConfigError(
      'ERROR: ADMIN_PASSWORD_HASH must be a PBKDF2-SHA256 hash generated by scripts/generate_admin_password_hash.',
    )
  }

  const adminLoginGlobalLimit = intEnv(process.env.ADMIN_LOGIN_GLOBAL_LIMIT, 20)
  if (adminLoginGlobalLimit < 1) {
    throw new ConfigError('ADMIN_LOGIN_GLOBAL_LIMIT must be positive.')
  }

  let cloudflareTrustedProxyCidrs: CidrRange[]
  try {
    cloudflareTrustedProxyCidrs = parseTrustedProxyCidrs(
      process.env.CLOUDFLARE_TRUSTED_PROXY_CIDRS ?? '',
    )
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError(String(error))
  }

  const trustCloudflareProxy = (process.env.TRUST_CLOUDFLARE_PROXY ?? 'false').toLowerCase() === 'true'
  if (trustCloudflareProxy && cloudflareTrustedProxyCidrs.length === 0) {
    console.warn(
      'TRUST_CLOUDFLARE_PROXY is enabled without CLOUDFLARE_TRUSTED_PROXY_CIDRS; ' +
        'CF-Connecting-IP will not be trusted.',
    )
  }

  return {
    dbDsn: await adjustDbDsn(rawDsn, options),
    apiSecret,
    adminSessionSecret,
    adminPasswordHash,
    enableApiDocs: (process.env.ENABLE_API_DOCS ?? 'false').toLowerCase() === 'true',
    allowedOrigins: ALLOWED_ORIGINS,
    whitelistChannelIds: new Set(WHITELIST_CHANNEL_IDS),
    privateChatChannelId: PRIVATE_CHAT_CHANNEL_ID,
    privateChatCategoryIds: PRIVATE_CHAT_CATEGORY_IDS,
    bottomChannelCategoryIds: BOTTOM_CHANNEL_CATEGORY_IDS,
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
  }
}
