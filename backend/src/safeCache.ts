import fs from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'

export class SafeDiskCache {
  private readonly db: Database
  private readonly filePath: string
  private readonly sizeLimitBytes: number
  private readonly now: () => number

  constructor(directory: string, sizeLimitBytes: number, now: () => number = Date.now) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.filePath = path.join(directory, 'cache.sqlite3')
    this.sizeLimitBytes = Math.max(sizeLimitBytes, 1024 * 1024)
    this.now = now

    this.db = new Database(this.filePath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA synchronous=NORMAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_entries (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at REAL,
          accessed_at REAL NOT NULL,
          value_size INTEGER NOT NULL
      )
    `)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_cache_expiry ON cache_entries (expires_at)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_cache_accessed ON cache_entries (accessed_at)')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at REAL NOT NULL)',
    )
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_rate_expiry ON rate_limits (expires_at)')
  }

  consumeLimit(key: string, limit: number, window: number): boolean {
    if (limit < 1 || window < 1) return false
    const now = this.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').run(now)
      const row = this.db
        .prepare('SELECT count, expires_at FROM rate_limits WHERE key = ?')
        .get(key) as { count: number; expires_at: number } | null
      if (row && row.count >= limit) {
        this.db.exec('COMMIT')
        return false
      }
      const nextCount = row ? row.count + 1 : 1
      const expiry = row ? row.expires_at : now + window
      this.db
        .prepare(
          `INSERT INTO rate_limits VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET count=excluded.count, expires_at=excluded.expires_at`,
        )
        .run(key, nextCount, expiry)
      this.db.exec('COMMIT')
      return true
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
      }
      throw error
    }
  }

  get(key: string): unknown {
    const now = this.now()
    const row = this.db
      .prepare('SELECT value, expires_at FROM cache_entries WHERE key = ?')
      .get(key) as { value: string; expires_at: number | null } | null
    if (!row) return undefined
    if (row.expires_at !== null && row.expires_at <= now) {
      this.db.prepare('DELETE FROM cache_entries WHERE key = ?').run(key)
      return undefined
    }
    this.db.prepare('UPDATE cache_entries SET accessed_at = ? WHERE key = ?').run(now, key)
    try {
      return JSON.parse(row.value) as unknown
    } catch {
      this.db.prepare('DELETE FROM cache_entries WHERE key = ?').run(key)
      return undefined
    }
  }

  set(key: string, value: unknown, expire?: number): void {
    const encoded = JSON.stringify(value) ?? 'null'
    const encodedSize = Buffer.byteLength(encoded, 'utf8')
    const now = this.now()
    const expiresAt = expire !== undefined ? now + expire : null

    this.db
      .prepare('DELETE FROM cache_entries WHERE expires_at IS NOT NULL AND expires_at <= ?')
      .run(now)
    this.db
      .prepare(
        `INSERT INTO cache_entries (key, value, expires_at, accessed_at, value_size)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             expires_at = excluded.expires_at,
             accessed_at = excluded.accessed_at,
             value_size = excluded.value_size`,
      )
      .run(key, encoded, expiresAt, now, encodedSize)

    let totalSize = this.selectTotalSize()
    while (totalSize > this.sizeLimitBytes) {
      const result = this.db
        .prepare(
          `DELETE FROM cache_entries
           WHERE key IN (
               SELECT key FROM cache_entries ORDER BY accessed_at ASC LIMIT 100
           )`,
        )
        .run()
      if (result.changes === 0) break
      totalSize = this.selectTotalSize()
    }
  }

  private selectTotalSize(): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(value_size), 0) AS total FROM cache_entries')
      .get() as { total: number } | null
    return row?.total ?? 0
  }

  close(): void {
    this.db.close()
  }
}
