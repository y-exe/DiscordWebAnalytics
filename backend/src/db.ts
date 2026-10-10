import pg from 'pg'
import type { Pool } from 'pg'

// DATE型(oid 1082)は 'yyyy-mm-dd' 文字列のまま扱う。
// JS Date 化するとローカルタイムゾーンの関係で日付がずれるため。
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

/**
 * 接続先ホストに応じてTLS要否を判定する (Python版 db_sslmode 相当)。
 *
 * 本番PostgreSQLはpg_hbaのhostsslでTCP接続のTLSを必須とする。
 * ローカル開発用PostgreSQLはTLS非対応のため、loopback系ホストはTLSなしで接続する。
 * pg v8 はDSN内の sslmode=require をverify-full相当として解釈し、
 * 自己署名証明書で失敗するため(vps Runbook参照)、sslmodeはDSNから除外して
 * 明示的に { rejectUnauthorized: false } を渡す (asyncpg の ssl=require 相当)。
 */
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
