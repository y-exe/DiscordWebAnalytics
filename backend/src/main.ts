import os from 'node:os'
import path from 'node:path'
import { createApp, startWarmLoop } from './api'
import { verifyAdminPassword } from './adminAuth'
import { ConfigError, loadConfig } from './config'
import { createBackendPool, resolveSslOptions } from './db'
import { consumeLoginLimits, initializeLoginLimits } from './loginLimits'
import { SafeDiskCache } from './safeCache'

const PORT = 8070

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  const line = `${new Date().toISOString()} [${level}] ymkw-api: ${message}`
  if (level === 'ERROR') console.error(line)
  else if (level === 'WARN') console.warn(line)
  else console.log(line)
}

function normalizeIp(address: string | undefined): string {
  if (!address) return 'unknown'
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

async function main(): Promise<void> {
  let cfg
  try {
    cfg = await loadConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }

  let safeDsn = cfg.dbDsn
  try {
    const parsed = new URL(cfg.dbDsn)
    const userinfo = parsed.username ? `${parsed.username}:****@` : ''
    safeDsn = `${parsed.protocol}//${userinfo}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`
  } catch {
    safeDsn = '(unparseable DSN)'
  }
  const ssl = resolveSslOptions(cfg.dbDsn)
  log('INFO', `Connecting to database at ${safeDsn} (sslmode=${ssl === false ? 'prefer' : 'require'})`)

  const pool = createBackendPool(cfg.dbDsn)
  try {
    await pool.query('SELECT 1')
  } catch (error) {
    log('ERROR', `Failed to create database pool: ${error}`)
    process.exit(1)
  }
  log('INFO', 'Database connection pool created (size: 1-8).')

  await initializeLoginLimits(pool)

  const cacheDir = path.join(os.tmpdir(), 'ymkw_api_diskcache_v14')
  const cache = new SafeDiskCache(cacheDir, cfg.cacheSizeLimitBytes)

  const app = createApp({
    config: cfg,
    cache,
    getPool: () => pool,
    consumeLoginLimits,
    verifyAdminPassword,
  })

  const stopWarmLoop = startWarmLoop(app)

  const server = Bun.serve({
    hostname: '0.0.0.0',
    port: PORT,
    fetch: (request, bunServer) =>
      app.fetch(request, { peerIp: normalizeIp(bunServer.requestIP(request)?.address) }),
  })
  log('INFO', `Listening on http://${server.hostname}:${server.port}`)

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    log('INFO', `Shutting down (${signal})...`)
    stopWarmLoop()
    server.stop(true)
    void pool
      .end()
      .catch(() => {})
      .finally(() => {
        cache.close()
        process.exit(0)
      })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

void main()
