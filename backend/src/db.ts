import pg from 'pg'
import type { Pool } from 'pg'

pg.types.setTypeParser(1082, (value: string) => value)

const LOCAL_DB_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
])

function safeHostname(dsn: string): string {
  try {
    return new URL(dsn).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return ''
  }
}

export function resolveSslOptions(dsn: string): boolean | { rejectUnauthorized: false } {
  return LOCAL_DB_HOSTS.has(safeHostname(dsn)) ? false : { rejectUnauthorized: false }
}

function sanitizedDsn(dsn: string): string {
  try {
    const url = new URL(dsn)
    url.searchParams.delete('sslmode')
    url.searchParams.delete('ssl')
    return url.toString()
  } catch {
    return dsn
  }
}

export function createBackendPool(dsn: string): Pool {
  return new pg.Pool({
    connectionString: sanitizedDsn(dsn),
    max: 8,
    idleTimeoutMillis: 30_000,
    ssl: resolveSslOptions(dsn),
    options: '-c application_name=ymkw-backend -c statement_timeout=60000',
  })
}
