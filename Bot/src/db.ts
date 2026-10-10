import pg from 'pg'
import type { Pool, PoolClient } from 'pg'

// DATE型(oid 1082)は 'yyyy-mm-dd' 文字列のまま扱う。
// JS Date 化するとローカルタイムゾーンの関係で日付がずれるため。
pg.types.setTypeParser(1082, (value: string) => value)

/** ローカル開発用ホスト(本番PostgreSQLはTLS必須のため対象外) */
const LOCAL_DB_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
])

function safeHostname(dsn: string): string {
  try {
    // WHATWG URL はIPv6ホストを [::1] 形式で返すため括弧を除去する
    return new URL(dsn).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return ''
  }
}

/**
 * asyncpg の ssl=require相当(暗号化のみ・証明書検証なし)を再現する。
 *
 * pg v8 はDSN内の sslmode=require をverify-full相当として解釈し、
 * 自己署名証明書の本番PostgreSQLでは接続に失敗する
 * (vpsリポジトリのRunbook参照)。
 * そのため sslmode パラメータはDSNから除外し、ホスト名から判定して明示指定する。
 */
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
  /** ステートメントタイムアウト(ミリ秒)。未指定なら設定しない */
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

/**
 * asyncpg の executemany 相当。複数行VALUESをまとめて1クエリで実行する。
 * baseSql は "INSERT INTO ... VALUES" までを渡し、行ごとのプレースホルダと
 * suffix (ON CONFLICT ...) を自動で連結する。
 */
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

/** トランザクション付きで実行する (asyncpg の connection.transaction() 相当) */
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
