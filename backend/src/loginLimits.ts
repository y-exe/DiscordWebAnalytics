import type { Pool, PoolClient } from 'pg'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_login_limits (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_login_limits_expiry ON admin_login_limits (expires_at);
`

const QUERY = `
INSERT INTO admin_login_limits (key, attempts, expires_at)
VALUES ($1, 1, EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) + $3::double precision)
ON CONFLICT (key) DO UPDATE SET
    attempts = CASE WHEN admin_login_limits.expires_at <= EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)
                    THEN 1 ELSE admin_login_limits.attempts + 1 END,
    expires_at = CASE WHEN admin_login_limits.expires_at <= EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)
                     THEN EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) + $3::double precision ELSE admin_login_limits.expires_at END
WHERE admin_login_limits.expires_at <= EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)
   OR admin_login_limits.attempts < $2
RETURNING attempts
`

/** HPAレプリカ間で共有されるログイン試行リミッタのテーブルを初期化する */
export async function initializeLoginLimits(pool: Pool): Promise<void> {
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(2026100801)')
    await client.query(SCHEMA)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * ログイン1回を消費する。クライアント単位と全体の両方の上限を満たす場合のみ true。
 * Python版と同様、片方だけ消費した場合でもその時点のカウントはコミットされる。
 */
export async function consumeLoginLimits(
  pool: Pool,
  clientKey: string,
  perClient: number,
  total: number,
  window: number,
): Promise<boolean> {
  if (Math.min(perClient, total, window) < 1) return false
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'DELETE FROM admin_login_limits WHERE expires_at <= EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)',
    )
    let allowed = true
    for (const [key, limit] of [
      [`client:${clientKey}`, perClient],
      ['global', total],
    ] as const) {
      const { rows } = await client.query(QUERY, [key, limit, window])
      if (rows.length === 0) {
        allowed = false
        break
      }
    }
    await client.query('COMMIT')
    return allowed
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
