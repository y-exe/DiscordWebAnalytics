import fs from 'node:fs'
import dns from 'node:dns/promises'
import dotenv from 'dotenv'

dotenv.config()

export const TOKEN = process.env.DISCORD_TOKEN

export interface DsnAdjustOptions {
  inContainer?: boolean
  localDbPort?: string
  canResolveHostDockerInternal?: () => Promise<boolean>
}

async function defaultCanResolveHostDockerInternal(): Promise<boolean> {
  try {
    await dns.lookup('host.docker.internal')
    return true
  } catch {
    return false
  }
}

function parseDsn(dsn: string): URL | null {
  try {
    return new URL(dsn)
  } catch {
    return null
  }
}

export async function adjustDbDsn(
  dsn: string | undefined,
  options: DsnAdjustOptions = {},
): Promise<string | null> {
  if (!dsn) return null

  const inContainer = options.inContainer ?? fs.existsSync('/.dockerenv')
  const localDbPort = options.localDbPort ?? process.env.LOCAL_DB_PORT ?? '5433'
  const canResolve =
    options.canResolveHostDockerInternal ?? defaultCanResolveHostDockerInternal

  const parsed = parseDsn(dsn)
  if (!parsed) return dsn

  if (!inContainer) {
    if (parsed.hostname === 'postgres-db') {
      parsed.hostname = 'localhost'
      parsed.port = localDbPort
      return parsed.toString()
    }
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1'
      return parsed.toString()
    }
    return dsn
  }

  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    if (await canResolve()) {
      parsed.hostname = 'host.docker.internal'
      return parsed.toString()
    }
    parsed.hostname = 'postgres-db'
    return parsed.toString()
  }

  return dsn
}

export const GUILD_ID = process.env.GUILD_ID || '0'
export const OWNER_ID = process.env.OWNER_ID || '0'
export const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || '0'
export const KING_ROLE_ID = process.env.KING_ROLE_ID || '0'
export const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID || '0'

const rawExcludedUsers = process.env.EXCLUDED_USER_IDS || '1491111267522314442'
export const EXCLUDED_USER_IDS = new Set(
  rawExcludedUsers
    .split(',')
    .map((uid) => uid.trim())
    .filter((uid) => /^\d+$/.test(uid)),
)
