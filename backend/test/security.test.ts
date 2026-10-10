import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Pool } from 'pg'

process.env.DB_DSN = 'postgresql://user:password@127.0.0.1:5432/test'
process.env.API_SECRET = 'a'.repeat(32)
process.env.ADMIN_SESSION_SECRET = 'b'.repeat(32)
process.env.ADMIN_PASSWORD_HASH =
  'pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
process.env.ENABLE_API_DOCS = 'false'

const config = await import('../src/config')
const { SafeDiskCache } = await import('../src/safeCache')
const adminAuth = await import('../src/adminAuth')
const db = await import('../src/db')
const { createApp, PUBLIC_PATHS } = await import('../src/api')

type AppDeps = Parameters<typeof createApp>[0]

interface TestApp {
  app: ReturnType<typeof createApp>
  verifyCalls: () => number
  cleanup: () => Promise<void>
}

async function cleanupDirectory(
  directory: string,
  ...stores: { close(): void }[]
): Promise<void> {
  for (const store of stores) {
    try {
      store.close()
    } catch {
    }
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(directory, { recursive: true, force: true })
      return
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function tempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ymkw-api-test-'))
}

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<TestApp> {
  const directory = tempDirectory()
  const cache = new SafeDiskCache(directory, 1024 * 1024)
  const cfg = await config.loadConfig()
  let verifyCalls = 0

  const deps: AppDeps = {
    config: cfg,
    cache,
    getPool: () => ({}) as unknown as Pool,
    consumeLoginLimits: async (_pool, clientKey, perClient, total, window) =>
      cache.consumeLimit(`client:${clientKey}`, perClient, window) &&
      cache.consumeLimit('global', total, window),
    verifyAdminPassword: async () => {
      verifyCalls++
      return false
    },
    ...overrides,
  }

  return {
    app: createApp(deps),
    verifyCalls: () => verifyCalls,
    cleanup: () => cleanupDirectory(directory, cache),
  }
}

function loginRequest(body?: string): RequestInit {
  return {
    method: 'POST',
    headers: { origin: 'https://ymkw.top' },
    body: body ?? JSON.stringify({ password: 'wrong' }),
  }
}

test('APIドキュメントはデフォルトで無効', async () => {
  const cfg = await config.loadConfig()
  assert.equal(cfg.enableApiDocs, false)
  const { app, cleanup } = await buildTestApp()
  try {
    assert.equal((await app.request('/docs')).status, 404)
    assert.equal((await app.request('/openapi.json')).status, 404)
  } finally {
    await cleanup()
  }
})

test('レートリミットは複数キャッシュインスタンス間でアトミック', async () => {
  const directory = tempDirectory()
  const stores = [new SafeDiskCache(directory, 1024 * 1024), new SafeDiskCache(directory, 1024 * 1024)]
  const allowed: boolean[] = []
  for (let index = 0; index < 40; index++) {
    allowed.push(stores[index % 2].consumeLimit('login', 5, 600))
  }
  assert.equal(allowed.filter(Boolean).length, 5)
  await cleanupDirectory(directory, ...stores)
})

test('キャッシュ追い出しはセキュリティカウンタを消さない', async () => {
  const directory = tempDirectory()
  const store = new SafeDiskCache(directory, 1024 * 1024)
  assert.equal(store.consumeLimit('login', 1, 600), true)
  store.set('large-cache-value', 'x'.repeat(2 * 1024 * 1024))
  assert.equal(store.consumeLimit('login', 1, 600), false)
  await cleanupDirectory(directory, store)
})

test('レート制限ウィンドウは期限切れでリセットされ、不正な上限は失敗扱い', async () => {
  const directory = tempDirectory()
  let fakeNow = 1000
  const store = new SafeDiskCache(directory, 1024 * 1024, () => fakeNow)
  assert.equal(store.consumeLimit('login', 1, 600), true)
  assert.equal(store.consumeLimit('login', 1, 600), false)
  assert.equal(store.consumeLimit('invalid', 0, 600), false)
  fakeNow = 1600
  assert.equal(store.consumeLimit('login', 1, 600), true)
  await cleanupDirectory(directory, store)
})

test('DSN書き換えは認証情報とクエリを保持する', async () => {
  const dsn =
    'postgresql://localhost-user:localhost-pass@localhost:5432/localhost-db?application_name=localhost'
  const local = await config.adjustDbDsn(dsn, { inContainer: false })
  assert.equal(local, dsn.replace('@localhost:', '@127.0.0.1:'))
  const container = await config.adjustDbDsn(dsn, {
    inContainer: true,
    canResolveHostDockerInternal: async () => true,
  })
  assert.equal(container, dsn.replace('@localhost:', '@host.docker.internal:'))
})

test('非ASCIIのAPIキーは例外なく拒否される', () => {
  assert.equal(adminAuth.isApiClient('\u00ff', 'a'.repeat(32)), false)
  assert.equal(adminAuth.isApiClient(undefined, 'a'.repeat(32)), false)
  assert.equal(adminAuth.isApiClient('a'.repeat(32), 'a'.repeat(32)), true)
})

test('管理セッションの往復と改竄検出', () => {
  const secret = 'b'.repeat(32)
  const now = 1_800_000_000
  const token = adminAuth.createAdminSession(secret, now)
  assert.equal(adminAuth.verifyAdminSession(token, secret, now), true)
  const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
  assert.equal(adminAuth.verifyAdminSession(tampered, secret, now), false)
  assert.equal(adminAuth.verifyAdminSession(null, secret, now), false)
  assert.equal(adminAuth.verifyAdminSession(undefined, secret, now), false)
})

test('管理系Originは許可リストで検証される', async () => {
  const cfg = await config.loadConfig()
  assert.equal(adminAuth.adminOriginAllowed(undefined, cfg.allowedOrigins), false)
  assert.equal(adminAuth.adminOriginAllowed('https://attacker.example', cfg.allowedOrigins), false)
  assert.equal(adminAuth.adminOriginAllowed('https://ymkw.top', cfg.allowedOrigins), true)
})

test('CF-Connecting-IPは信頼済みプロキシからのみ採用される', () => {
  const trusted = config.parseTrustedProxyCidrs('192.0.2.0/24, 2001:db8::/32')
  const spoofed = ['198.51.100.7', '203.0.113.8'] as const
  const proxied = ['192.0.2.7', '203.0.113.8'] as const
  const malformed = ['192.0.2.7', 'not-an-ip'] as const
  assert.equal(config.getClientIp(spoofed[0], spoofed[1], true, trusted), spoofed[0])
  assert.equal(config.getClientIp(proxied[0], proxied[1], true, trusted), proxied[1])
  assert.equal(config.getClientIp(malformed[0], malformed[1], true, trusted), malformed[0])
})

test('リモートDBはTLS必須・loopbackはTLSなしで接続する', () => {
  assert.deepEqual(db.resolveSslOptions('postgresql://user:password@postgres-db:5432/discord_logs'), {
    rejectUnauthorized: false,
  })
  assert.equal(db.resolveSslOptions('postgresql://user:password@127.0.0.1:5433/test'), false)
})

test('6回目のログイン試行はパスワード検証前に拒否される', async () => {
  const { app, verifyCalls, cleanup } = await buildTestApp({
    getPeerIp: () => '203.0.113.10',
  })
  try {
    const statuses: number[] = []
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await app.request('/admin/login', loginRequest())
      statuses.push(response.status)
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429])
    assert.equal(verifyCalls(), 5)
  } finally {
    await cleanup()
  }
})

test('IPを変えても全体上限に到達すれば拒否される', async () => {
  const previous = process.env.ADMIN_LOGIN_GLOBAL_LIMIT
  process.env.ADMIN_LOGIN_GLOBAL_LIMIT = '3'
  try {
    let attempt = 0
    const { app, verifyCalls, cleanup } = await buildTestApp({
      getPeerIp: () => `203.0.113.${++attempt}`,
    })
    try {
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) {
        const response = await app.request('/admin/login', loginRequest())
        statuses.push(response.status)
      }
      assert.deepEqual(statuses, [401, 401, 401, 429])
      assert.equal(verifyCalls(), 3)
    } finally {
      cleanup()
    }
  } finally {
    if (previous === undefined) delete process.env.ADMIN_LOGIN_GLOBAL_LIMIT
    else process.env.ADMIN_LOGIN_GLOBAL_LIMIT = previous
  }
})

test('過大なログインボディはパスワード検証前に拒否される', async () => {
  const { app, verifyCalls, cleanup } = await buildTestApp({
    getPeerIp: () => '203.0.113.10',
  })
  try {
    const response = await app.request('/admin/login', loginRequest('x'.repeat(2049)))
    assert.equal(response.status, 413)
    assert.equal(verifyCalls(), 0)
  } finally {
    await cleanup()
  }
})

test('リミッタ障害時はログインを許可しない (fail-closed)', async () => {
  const { app, verifyCalls, cleanup } = await buildTestApp({
    getPeerIp: () => '203.0.113.10',
    consumeLoginLimits: async () => {
      throw new Error('database unavailable')
    },
  })
  const originalError = console.error
  console.error = () => {}
  try {
    const response = await app.request('/admin/login', loginRequest())
    assert.equal(response.status, 503)
    assert.equal(verifyCalls(), 0)
  } finally {
    console.error = originalError
    await cleanup()
  }
})

test('パブリックパスと書き込みメソッドの保護', async () => {
  const { app, cleanup } = await buildTestApp()
  try {
    assert.equal((await app.request('/health')).status, 200)
    assert.equal((await app.request('/')).status, 200)
    const unauthenticated = await app.request('/ranking/total', { method: 'POST' })
    assert.equal(unauthenticated.status, 401)
    assert.ok(PUBLIC_PATHS.has('/health'))
  } finally {
    await cleanup()
  }
})
