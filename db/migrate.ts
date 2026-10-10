import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { Client } from 'pg'
import dotenv from 'dotenv'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const MIGRATIONS_DIR = path.join(HERE, 'migrations')

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal'])

function safeHostname(dsn: string): string {
  try {
    return new URL(dsn).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return ''
  }
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

function resolveSslOptions(dsn: string): boolean | { rejectUnauthorized: false } {
  return LOCAL_DB_HOSTS.has(safeHostname(dsn)) ? false : { rejectUnauthorized: false }
}

function readEnvFile(filePath: string): Record<string, string> {
  try {
    return dotenv.parse(fs.readFileSync(filePath))
  } catch {
    return {}
  }
}

function getDsn(): string {
  for (const [key, value] of Object.entries(readEnvFile(path.join(ROOT, '.env')))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  for (const [key, value] of Object.entries(readEnvFile(path.join(ROOT, 'Bot', '.env')))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  for (const [key, value] of Object.entries(readEnvFile(path.join(ROOT, 'backend', '.env')))) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  let dsn = process.env.DB_DSN
  if (!dsn) {
    console.error('DB_DSN is required (environment, Bot/.env, or backend/.env).')
    process.exit(1)
  }

  if (!fs.existsSync('/.dockerenv')) {
    try {
      const parsed = new URL(dsn)
      if (parsed.hostname === 'postgres-db') {
        parsed.hostname = '127.0.0.1'
        parsed.port = process.env.LOCAL_DB_PORT ?? '5433'
        dsn = parsed.toString()
      } else if (parsed.hostname === 'localhost') {
        parsed.hostname = '127.0.0.1'
        dsn = parsed.toString()
      }
    } catch {
    }
  }
  return dsn
}

async function migrate(): Promise<void> {
  const dsn = getDsn()
  const client: Client = new pg.Client({
    connectionString: sanitizedDsn(dsn),
    ssl: resolveSslOptions(dsn),
  })
  await client.connect()
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('ymkw-top-schema-migrations'))")
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
          filename TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const applied = new Map<string, string>()
    {
      const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations')
      for (const row of rows) applied.set(row.filename as string, row.checksum as string)
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort()
    for (const filename of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8')
      const checksum = crypto.createHash('sha256').update(sql, 'utf8').digest('hex')
      const previousChecksum = applied.get(filename)
      if (previousChecksum) {
        if (previousChecksum !== checksum) {
          throw new Error(`Applied migration was edited: ${filename}`)
        }
        continue
      }

      const nonTransactional = sql.trimStart().startsWith('-- migrate: no-transaction')
      if (nonTransactional) {
        const statement = sql
          .split('\n')
          .filter((line) => line.trim() !== '-- migrate: no-transaction')
          .join('\n')
        await client.query(statement)
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          filename,
          checksum,
        ])
      } else {
        try {
          await client.query('BEGIN')
          await client.query(sql)
          await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
            filename,
            checksum,
          ])
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {})
          throw error
        }
      }
      console.log(`Applied ${filename}`)
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('ymkw-top-schema-migrations'))")
    } finally {
      await client.end()
    }
  }
}

void migrate()
