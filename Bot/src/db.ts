import pg from 'pg'
import type { Pool, PoolClient } from 'pg'

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

export function resolveSslOptions(
  dsn: string,
): boolean | { rejectUnauthorized: false } {
  return LOCAL_DB_HOSTS.has(safeHostname(dsn))
    ? false
    : { rejectUnauthorized: false }
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

export interface BotPoolOptions {
  max: number
  applicationName: string
  statementTimeoutMs?: number
}

export function createPool(dsn: string, options: BotPoolOptions): Pool {
  const startupOptions = [
    `-c application_name=${options.applicationName}`,
    ...(options.statementTimeoutMs
      ? [`-c statement_timeout=${options.statementTimeoutMs}`]
      : []),
  ].join(' ')

  return new pg.Pool({
    connectionString: sanitizedDsn(dsn),
    max: options.max,
    ssl: resolveSslOptions(dsn),
    options: startupOptions,
  })
}

export async function batchExecute(
  poolOrClient: Pool | PoolClient,
  baseSql: string,
  rows: unknown[][],
  options: { suffix?: string; chunkSize?: number } = {},
): Promise<void> {
  const suffix = options.suffix ?? ''
  const chunkSize = options.chunkSize ?? 500
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize)
    const values: unknown[] = []
    const tuples = chunk.map(
      (row) =>
        `(${row
          .map((value) => {
            values.push(value)
            return `$${values.length}`
          })
          .join(', ')})`,
    )
    await poolOrClient.query(`${baseSql} ${tuples.join(', ')}${suffix}`, values)
  }
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
