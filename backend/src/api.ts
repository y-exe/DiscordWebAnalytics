import { cors } from 'hono/cors'
import { getCookie } from 'hono/cookie'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { HttpBindings } from '@hono/node-server'
import type { Pool } from 'pg'
import {
  ADMIN_COOKIE_NAME,
  ADMIN_LOGIN_LIMIT,
  ADMIN_LOGIN_WINDOW,
  adminClientKey,
  adminOriginAllowed,
  adminSessionCookie,
  adminSessionCookieDeletion,
  createAdminSession,
  isApiClient,
  verifyAdminSession,
} from './adminAuth'
import { getClientIp } from './config'
import type { AppConfig } from './config'

export const PUBLIC_PATHS = new Set(['/', '/health', '/docs', '/openapi.json', '/favicon.ico'])
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const DB_HEAVY_PREFIXES = ['/ranking', '/stats', '/users']
const LIVE_TOTAL_CACHE_TTL = 1800
export const TOTAL_CACHE_WARM_INTERVAL_MS = 600 * 1000

const DELETED_USER_FILTER =
  "(u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND u.display_name NOT ILIKE 'deleted%user')"

export interface AppDeps {
  config: AppConfig
  cache: {
    get(key: string): unknown
    set(key: string, value: unknown, expire?: number): void
    consumeLimit(key: string, limit: number, window: number): boolean
  }
  getPool: () => Pool | null
  consumeLoginLimits: (
    pool: Pool,
    clientKey: string,
    perClient: number,
    total: number,
    window: number,
  ) => Promise<boolean>
  verifyAdminPassword: (password: string, hash: string) => Promise<boolean>
  /** テスト用にクライアントIPを上書きする */
  getPeerIp?: (c: Context) => string
}

type AppEnv = { Bindings: HttpBindings }

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  const responseHeaders = new Headers({ 'Content-Type': 'application/json' })
  if (headers) {
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value)
  }
  return new Response(JSON.stringify(body), { status, headers: responseHeaders })
}

function jsonError(status: number, message: string, headers?: Record<string, string>): Response {
  return jsonResponse({ detail: message }, status, headers)
}

function plainTextResponse(text: string, headers?: Record<string, string>): Response {
  const responseHeaders = new Headers()
  if (headers) {
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value)
  }
  return new Response(text, { headers: responseHeaders })
}

function noContent(headers?: Record<string, string>): Response {
  const responseHeaders = new Headers()
  if (headers) {
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value)
  }
  return new Response(null, { status: 204, headers: responseHeaders })
}

function defaultGetPeerIp(c: Context): string {
  const incoming = (c.env as Partial<HttpBindings> | undefined)?.incoming
  return incoming?.socket?.remoteAddress ?? 'unknown'
}

/** 2048バイト上限でリクエストボディを読む (超過時は null) */
async function readBodyCapped(request: Request, cap: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0)
  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > cap) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function pathInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

/** 現在のJST年月 (Python版 datetime.now(ZoneInfo("Asia/Tokyo")) 相当) */
function jstYearMonth(date = new Date()): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).format(date)
  const [year, month] = formatted.split('-').map(Number)
  return { year, month }
}

interface RankingItem {
  user_id: string
  display_name: string
  username: string
  avatar: string | null
  count: number
  char_count: number
}

interface UserRankItem extends RankingItem {
  rank: number
}

interface QueryRow {
  [column: string]: unknown
}

function formatRankingResponse(rows: QueryRow[]): RankingItem[] {
  return rows.map((row) => ({
    user_id: String(row.user_id),
    display_name: (row.display_name as string) || 'Unknown',
    username: (row.username as string) || 'unknown',
    avatar: (row.avatar_url as string | null) ?? null,
    count: Number(row.c),
    char_count: Number(row.chars || 0),
  }))
}

function formatUserRankResponse(row: QueryRow | undefined): UserRankItem | null {
  if (!row) return null
  return {
    user_id: String(row.user_id),
    display_name: (row.display_name as string) || 'Unknown',
    username: (row.username as string) || 'unknown',
    avatar: (row.avatar_url as string | null) ?? null,
    count: Number(row.c),
    char_count: Number(row.chars || 0),
    rank: Number(row.rank),
  }
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function monthBounds(year: number, month: number): Date[] | string {
  if (year < 2020 || year > 2100) return 'year must be between 2020 and 2100'
  if (month < 1 || month > 12) return 'month must be between 1 and 12'
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = month === 12 ? new Date(Date.UTC(year + 1, 0, 1)) : new Date(Date.UTC(year, month, 1))
  return [start, end]
}

function isDbHeavyPath(path: string): boolean {
  return DB_HEAVY_PREFIXES.some((prefix) => path.startsWith(prefix))
}

function addChannelScopeFilter(
  params: unknown[],
  filters: string[],
  column: string,
  channelIds: string[] | null,
): void {
  if (channelIds !== null) {
    params.push(channelIds)
    filters.push(`${column} = ANY($${params.length}::bigint[])`)
  }
}

function computeUserIdsKey(userIds: string[]): string {
  return userIds.length === 0 ? 'None' : JSON.stringify(userIds)
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const cfg = deps.config
  const cache = deps.cache
  const getPeerIp = deps.getPeerIp ?? defaultGetPeerIp

  async function getChannelScopeIds(
    pool: Pool,
    channelId: string | null,
  ): Promise<string[] | null | Response> {
    if (!channelId) return null
    if (channelId !== cfg.privateChatChannelId && !cfg.whitelistChannelIds.has(channelId)) {
      return jsonError(404, 'Channel not found')
    }

    if (channelId === cfg.privateChatChannelId) {
      const { rows } = await pool.query(
        `
        SELECT channel_id
        FROM channels
        WHERE is_active = TRUE
          AND (
              (category_id IS NULL AND category_name = '未分類')
              OR (category_id IS NOT NULL AND NOT (category_id = ANY($1::bigint[])))
          )
        `,
        [cfg.privateChatCategoryIds],
      )
      return rows.map((row) => String(row.channel_id))
    }

    const { rows: channelRows } = await pool.query(
      'SELECT name FROM channels WHERE channel_id = $1',
      [channelId],
    )
    if (channelRows.length === 0) return [channelId]

    const childPrefix = `${escapeLike(channelRows[0].name as string)} / %`
    const { rows } = await pool.query(
      `
      SELECT channel_id
      FROM channels
      WHERE channel_id = $1 OR name LIKE $2 ESCAPE '\\'
      `,
      [channelId, childPrefix],
    )
    return rows.length > 0 ? rows.map((row) => String(row.channel_id)) : [channelId]
  }

  /** 当月・未来月はBot/管理セッションのみアクセス可能 (Python版 require_month_access) */
  function requireMonthAccess(
    c: Context,
    year: number,
    month: number,
  ): { isRestricted: boolean } | { error: Response } {
    const now = jstYearMonth()
    const isRestricted =
      year > now.year || (year === now.year && month >= now.month)
    if (
      isRestricted &&
      !isApiClient(c.req.header('x-api-key'), cfg.apiSecret) &&
      !verifyAdminSession(getCookie(c, ADMIN_COOKIE_NAME), cfg.adminSessionSecret)
    ) {
      return { error: jsonError(403, "This month's report is not public yet.") }
    }
    return { isRestricted }
  }

  const monthCacheControl = (isRestricted: boolean): Record<string, string> =>
    isRestricted
      ? { 'Cache-Control': 'private, no-store' }
      : { 'Cache-Control': 'public, max-age=600' }

  const app = new Hono<AppEnv>()

  // CORSは最外側 (エラーレスポンスにもCORSヘッダーが付く)
  app.use(
    '*',
    cors({
      origin: cfg.allowedOrigins,
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Accept', 'Content-Type'],
      exposeHeaders: ['X-Debug-Block'],
    }),
  )

  // セキュリティ・レートリミットミドルウェア (Python版 security_and_rate_limit_middleware)
  app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') {
      await next()
      return
    }

    const isBot = isApiClient(c.req.header('x-api-key'), cfg.apiSecret)
    const path = c.req.path
    const isPublicPath = PUBLIC_PATHS.has(path)

    if (
      WRITE_METHODS.has(c.req.method) &&
      !isBot &&
      !isPublicPath &&
      path !== '/admin/login' &&
      path !== '/admin/logout'
    ) {
      return jsonResponse({ detail: 'API key required.' }, 401, {
        'X-Debug-Block': 'write-api-key-required',
      })
    }

    const clientIp = getPeerIp(c)

    const blockKey = `blocked:${clientIp}`
    if (cache.get(blockKey)) {
      return jsonResponse({ detail: 'Too Many Requests. Blocked for 10 minutes.' }, 429, {
        'X-Debug-Block': 'rate-limit-active',
      })
    }

    const requestLimit = isBot ? cfg.botMaxRequests : cfg.maxRequests
    if (!cache.consumeLimit(`request:${clientIp}`, requestLimit, cfg.rateLimitWindow)) {
      cache.set(blockKey, true, cfg.blockDuration)
      return jsonResponse({ detail: 'Too Many Requests. Blocked for 10 minutes.' }, 429, {
        'X-Debug-Block': 'rate-limit-exceeded',
      })
    }

    if (!isPublicPath && isDbHeavyPath(path)) {
      const dbLimit = isBot ? cfg.dbBotMaxRequests : cfg.dbMaxRequests
      if (!cache.consumeLimit(`db:${clientIp}`, dbLimit, cfg.dbRateLimitWindow)) {
        cache.set(blockKey, true, cfg.blockDuration)
        return jsonResponse({ detail: 'Too Many Requests. Blocked for 10 minutes.' }, 429, {
          'X-Debug-Block': 'db-rate-limit-exceeded',
        })
      }
    }

    try {
      await next()
      c.res.headers.set('X-Content-Type-Options', 'nosniff')
      c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
      c.res.headers.set('X-Frame-Options', 'DENY')
      return
    } catch (error) {
      console.error(`Unhandled exception during request: ${c.req.method} ${path}`, error)
      return jsonResponse(
        {
          detail: 'Internal Server Error',
          error_type: error instanceof Error ? error.constructor.name : typeof error,
        },
        500,
        { 'X-Debug-Block': 'internal-error' },
      )
    }
  })

  app.notFound((c) => {
    return jsonResponse({ detail: 'Not Found' }, 404)
  })

  app.onError((error, c) => {
    console.error(`Unhandled error: ${c.req.method} ${c.req.path}`, error)
    return jsonResponse({ detail: 'Internal Server Error' }, 500)
  })

  app.get('/', (c) => plainTextResponse('ymkw.top API by yexe'))

  app.get('/health', (c) => plainTextResponse('ok'))

  if (cfg.enableApiDocs) {
    app.get('/docs', (c) =>
      plainTextResponse('API docs are enabled. See /openapi.json.', {
        'Content-Type': 'text/html; charset=utf-8',
      }),
    )
    app.get('/redoc', (c) => plainTextResponse('API docs are enabled. See /openapi.json.'))
    app.get('/openapi.json', (c) =>
      jsonResponse({
        openapi: '3.1.0',
        info: { title: 'ymkw.top API', version: '1.0.0' },
        paths: {},
      }),
    )
  }

  app.get('/admin/session', (c) => {
    if (!adminOriginAllowed(c.req.header('origin'), cfg.allowedOrigins)) {
      return jsonError(403, 'Invalid origin.')
    }
    if (!verifyAdminSession(getCookie(c, ADMIN_COOKIE_NAME), cfg.adminSessionSecret)) {
      return jsonError(401, 'Not authenticated.')
    }
    return noContent({ 'Cache-Control': 'no-store' })
  })

  app.post('/admin/login', async (c) => {
    if (!adminOriginAllowed(c.req.header('origin'), cfg.allowedOrigins)) {
      return jsonError(403, 'Invalid origin.')
    }
    const clientIp = getPeerIp(c)
    const clientKey = adminClientKey(clientIp, cfg.adminSessionSecret)
    const ipTag = clientKey.slice(0, 12)
    const pool = deps.getPool()
    if (!pool) {
      return jsonError(503, 'Login service unavailable.')
    }
    let allowed: boolean
    try {
      allowed = await deps.consumeLoginLimits(
        pool,
        clientKey,
        ADMIN_LOGIN_LIMIT,
        cfg.adminLoginGlobalLimit,
        ADMIN_LOGIN_WINDOW,
      )
    } catch (error) {
      console.error('admin_login outcome=limiter_unavailable', error)
      return jsonError(503, 'Login service unavailable.')
    }
    if (!allowed) {
      console.warn(`admin_login outcome=rate_limited client=${ipTag}`)
      return jsonError(429, 'Too many login attempts.', {
        'Retry-After': String(ADMIN_LOGIN_WINDOW),
      })
    }

    const body = await readBodyCapped(c.req.raw, 2048)
    if (body === null) {
      return jsonError(413, 'Request body too large.')
    }
    let password = ''
    try {
      const payload: unknown = JSON.parse(body.toString('utf8'))
      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
        const candidate = (payload as { password?: unknown }).password
        if (typeof candidate === 'string') password = candidate
      }
    } catch {
      return jsonError(400, 'Invalid request body.')
    }

    if (!(await deps.verifyAdminPassword(password, cfg.adminPasswordHash))) {
      console.warn(`admin_login outcome=invalid_password client=${ipTag}`)
      return jsonError(401, 'Invalid password.')
    }
    console.info(`admin_login outcome=success client=${ipTag}`)

    return noContent({
      'Cache-Control': 'no-store',
      'Set-Cookie': adminSessionCookie(
        createAdminSession(cfg.adminSessionSecret, Math.floor(Date.now() / 1000)),
      ),
    })
  })

  app.post('/admin/logout', (c) => {
    if (!adminOriginAllowed(c.req.header('origin'), cfg.allowedOrigins)) {
      return jsonError(403, 'Invalid origin.')
    }
    return noContent({
      'Cache-Control': 'no-store',
      'Set-Cookie': adminSessionCookieDeletion(),
    })
  })

  app.get('/channels', async (c) => {
    const headers = { 'Cache-Control': 'public, max-age=3600' }
    const ckey = 'channels_list'
    const cached = cache.get(ckey)
    if (cached !== undefined && cached !== null) return jsonResponse(cached, 200, headers)

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const { rows } = await pool.query(
      'SELECT * FROM channels WHERE is_active = TRUE ORDER BY position ASC',
    )

    const visibleRows = rows.filter((row) =>
      cfg.whitelistChannelIds.has(String(row.channel_id)),
    )
    visibleRows.sort((a, b) => {
      const aBottom = a.category_id !== null && cfg.bottomChannelCategoryIds.has(String(a.category_id))
      const bBottom = b.category_id !== null && cfg.bottomChannelCategoryIds.has(String(b.category_id))
      if (aBottom !== bBottom) return aBottom ? 1 : -1
      return (Number(a.position) || 999999) - (Number(b.position) || 999999)
    })

    const res = [
      {
        id: cfg.privateChatChannelId,
        name: 'プラチャ総合',
        category: 'プラチャ',
      },
      ...visibleRows.map((row) => ({
        id: String(row.channel_id),
        name: row.name as string,
        category: (row.category_name as string) || '未分類',
      })),
    ]

    cache.set(ckey, res, 3600)
    return jsonResponse(res, 200, headers)
  })

  app.get('/users/search', async (c) => {
    const q = c.req.query('q')
    if (q === undefined || q.length < 1 || q.length > 64) {
      return jsonError(422, 'Query validation failed: q must be 1-64 characters')
    }
    const searchQuery = q.trim()
    if (!searchQuery) return jsonResponse([])

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const { rows } = await pool.query(
      `SELECT user_id, display_name, username, avatar_url FROM users u WHERE (display_name ILIKE $1 OR username ILIKE $1) AND ${DELETED_USER_FILTER} LIMIT 10`,
      [`%${searchQuery}%`],
    )
    return jsonResponse(
      rows.map((row) => ({
        user_id: String(row.user_id),
        display_name: row.display_name,
        username: row.username,
        avatar: row.avatar_url,
      })),
    )
  })

  app.get('/ranking/monthly/:year/:month', async (c) => {
    const year = pathInt(c.req.param('year'))
    const month = pathInt(c.req.param('month'))
    if (year === null || month === null) return jsonError(422, 'Invalid path parameter')
    const access = requireMonthAccess(c, year, month)
    if ('error' in access) return access.error

    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null

    const ckey = `rank_m_${year}_${month}_${channelId ?? 'None'}`
    const headers = monthCacheControl(access.isRestricted)
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const bounds = monthBounds(year, month)
    if (!Array.isArray(bounds)) return jsonError(400, bounds)
    const [startDate, endDate] = bounds

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = [startDate, endDate]
    const filters = [
      'm.created_at >= $1',
      'm.created_at < $2',
      'm.is_bot = FALSE',
      DELETED_USER_FILTER,
    ]
    addChannelScopeFilter(params, filters, 'm.channel_id', scope)
    const query = `
      SELECT m.user_id, count(*) as c, sum(m.char_count) as chars, u.display_name, u.username, u.avatar_url
      FROM messages m LEFT JOIN users u ON m.user_id = u.user_id
      WHERE ${filters.join(' AND ')}
      GROUP BY m.user_id, u.display_name, u.username, u.avatar_url
      ORDER BY c DESC LIMIT 100`
    const { rows } = await pool.query(query, params)
    const res = formatRankingResponse(rows)
    cache.set(ckey, res, 600)
    return jsonResponse(res, 200, headers)
  })

  app.get('/ranking/total', async (c) => {
    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null
    const endRaw = c.req.query('end_date')
    const endDate = parseEndDate(endRaw)
    if (endDate === 'invalid') return jsonError(422, 'Invalid query parameter: end_date')

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL
    const headers = { 'Cache-Control': `public, max-age=${ttl}` }
    const ckey = `rank_t_${channelId ?? 'None'}_${endRaw ?? 'None'}`
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = []
    const filters = ['m.is_bot = FALSE', DELETED_USER_FILTER]
    addChannelScopeFilter(params, filters, 'm.channel_id', scope)
    if (endDate) {
      params.push(endDate)
      filters.push(`m.created_at <= $${params.length}`)
    }
    const query = `
      SELECT m.user_id, count(*) as c, sum(m.char_count) as chars, u.display_name, u.username, u.avatar_url
      FROM messages m LEFT JOIN users u ON m.user_id = u.user_id
      WHERE ${filters.join(' AND ')}
      GROUP BY m.user_id, u.display_name, u.username, u.avatar_url
      ORDER BY c DESC LIMIT 100`
    const { rows } = await pool.query(query, params)
    const res = formatRankingResponse(rows)
    cache.set(ckey, res, ttl)
    return jsonResponse(res, 200, headers)
  })

  app.get('/users/:userId/rank/monthly/:year/:month', async (c) => {
    const userId = c.req.param('userId')
    if (!/^\d+$/.test(userId)) return jsonError(422, 'Invalid path parameter: user_id')
    const year = pathInt(c.req.param('year'))
    const month = pathInt(c.req.param('month'))
    if (year === null || month === null) return jsonError(422, 'Invalid path parameter')

    const access = requireMonthAccess(c, year, month)
    if ('error' in access) return access.error

    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null

    const ckey = `user_rank_m_${userId}_${year}_${month}_${channelId ?? 'None'}`
    const headers = monthCacheControl(access.isRestricted)
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached ?? null, 200, headers)

    const bounds = monthBounds(year, month)
    if (!Array.isArray(bounds)) return jsonError(400, bounds)
    const [startDate, endDate] = bounds

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = [startDate, endDate]
    const filters = [
      'm.created_at >= $1',
      'm.created_at < $2',
      'm.is_bot = FALSE',
      DELETED_USER_FILTER,
    ]
    addChannelScopeFilter(params, filters, 'm.channel_id', scope)
    params.push(userId)
    const targetParam = `$${params.length}`

    const query = `
        WITH counts AS (
            SELECT m.user_id, count(*) AS c, sum(m.char_count) AS chars
            FROM messages m
            LEFT JOIN users u ON m.user_id = u.user_id
            WHERE ${filters.join(' AND ')}
            GROUP BY m.user_id
        ),
        target AS (
            SELECT user_id, c, chars
            FROM counts
            WHERE user_id = ${targetParam}
        )
        SELECT
            t.user_id,
            t.c,
            t.chars,
            u.display_name,
            u.username,
            u.avatar_url,
            (SELECT count(*) + 1 FROM counts c2 WHERE c2.c > t.c)::int AS rank
        FROM target t
        LEFT JOIN users u ON t.user_id = u.user_id
    `
    const { rows } = await pool.query(query, params)
    const res = formatUserRankResponse(rows[0])
    cache.set(ckey, res, 600)
    return jsonResponse(res, 200, headers)
  })

  app.get('/users/:userId/rank/total', async (c) => {
    const userId = c.req.param('userId')
    if (!/^\d+$/.test(userId)) return jsonError(422, 'Invalid path parameter: user_id')
    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null
    const endRaw = c.req.query('end_date')
    const endDate = parseEndDate(endRaw)
    if (endDate === 'invalid') return jsonError(422, 'Invalid query parameter: end_date')

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL
    const headers = { 'Cache-Control': `public, max-age=${ttl}` }
    const ckey = `user_rank_t_${userId}_${channelId ?? 'None'}_${endRaw ?? 'None'}`
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached ?? null, 200, headers)

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = []
    const filters = ['m.is_bot = FALSE', DELETED_USER_FILTER]
    addChannelScopeFilter(params, filters, 'm.channel_id', scope)
    if (endDate) {
      params.push(endDate)
      filters.push(`m.created_at <= $${params.length}`)
    }
    params.push(userId)
    const targetParam = `$${params.length}`

    const query = `
        WITH counts AS (
            SELECT m.user_id, count(*) AS c, sum(m.char_count) AS chars
            FROM messages m
            LEFT JOIN users u ON m.user_id = u.user_id
            WHERE ${filters.join(' AND ')}
            GROUP BY m.user_id
        ),
        target AS (
            SELECT user_id, c, chars
            FROM counts
            WHERE user_id = ${targetParam}
        )
        SELECT
            t.user_id,
            t.c,
            t.chars,
            u.display_name,
            u.username,
            u.avatar_url,
            (SELECT count(*) + 1 FROM counts c2 WHERE c2.c > t.c)::int AS rank
        FROM target t
        LEFT JOIN users u ON t.user_id = u.user_id
    `
    const { rows } = await pool.query(query, params)
    const res = formatUserRankResponse(rows[0])
    cache.set(ckey, res, ttl)
    return jsonResponse(res, 200, headers)
  })

  app.get('/stats/history/:year/:month', async (c) => {
    const year = pathInt(c.req.param('year'))
    const month = pathInt(c.req.param('month'))
    if (year === null || month === null) return jsonError(422, 'Invalid path parameter')

    const userIds = c.req.queries('user_id') ?? []
    if (userIds.length > 5) {
      return jsonError(400, 'At most 5 user_id values are allowed')
    }

    const access = requireMonthAccess(c, year, month)
    if ('error' in access) return access.error

    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null

    const ckey = `hist_m_${year}_${month}_${channelId ?? 'None'}_${computeUserIdsKey(userIds)}`
    const headers = monthCacheControl(access.isRestricted)
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const bounds = monthBounds(year, month)
    if (!Array.isArray(bounds)) return jsonError(400, bounds)
    const [startDate, endDate] = bounds

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = [startDate, endDate]
    const filters = ['created_at >= $1', 'created_at < $2', 'is_bot = FALSE']
    addChannelScopeFilter(params, filters, 'channel_id', scope)
    const where = filters.join(' AND ')

    const { rows: tRows } = await pool.query(
      `SELECT DATE(created_at) as d, count(*) as c FROM messages WHERE ${where} GROUP BY DATE(created_at)`,
      params,
    )
    const topWhere = where
      .replaceAll('channel_id', 'm.channel_id')
      .replaceAll('created_at', 'm.created_at')
      .replaceAll('is_bot', 'm.is_bot')
    const { rows: topU } = await pool.query(
      `SELECT m.user_id, count(*) as c FROM messages m LEFT JOIN users u ON m.user_id = u.user_id WHERE ${topWhere} AND ${DELETED_USER_FILTER} GROUP BY m.user_id ORDER BY c DESC LIMIT 100`,
      params,
    )

    const targetIds = topU.map((row) => String(row.user_id))
    for (const uid of userIds) {
      if (/^\d+$/.test(uid) && !targetIds.includes(uid)) targetIds.push(uid)
    }

    const dataMap = new Map<string, Record<string, unknown>>()
    for (const row of tRows) {
      const date = String(row.d)
      dataMap.set(date, { date, total: Number(row.c) })
    }
    const uDetails: Record<string, Record<string, unknown>> = {}
    if (targetIds.length > 0) {
      const detailParams = [...params, targetIds]
      const { rows } = await pool.query(
        `SELECT DATE(created_at) as d, user_id, count(*) as c FROM messages WHERE ${where} AND user_id = ANY($${detailParams.length}::bigint[]) GROUP BY DATE(created_at), user_id`,
        detailParams,
      )
      for (const row of rows) {
        const date = String(row.d)
        if (!dataMap.has(date)) dataMap.set(date, { date, total: 0 })
        dataMap.get(date)![String(row.user_id)] = Number(row.c)
      }
      const { rows: uRows } = await pool.query(
        'SELECT user_id, display_name, username, avatar_url FROM users WHERE user_id = ANY($1::bigint[])',
        [targetIds],
      )
      for (const row of uRows) {
        uDetails[String(row.user_id)] = {
          name: row.display_name,
          username: row.username,
          avatar: row.avatar_url,
        }
      }
    }

    const chartData = [...dataMap.values()].sort((a, b) =>
      String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0,
    )
    const res = {
      chart_data: chartData,
      users: uDetails,
      top_user_id: topU.length > 0 ? String(topU[0].user_id) : null,
    }
    cache.set(ckey, res, 600)
    return jsonResponse(res, 200, headers)
  })

  app.get('/stats/history/total', async (c) => {
    const userIds = c.req.queries('user_id') ?? []
    if (userIds.length > 5) {
      return jsonError(400, 'At most 5 user_id values are allowed')
    }
    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null
    const endRaw = c.req.query('end_date')
    const endDate = parseEndDate(endRaw)
    if (endDate === 'invalid') return jsonError(422, 'Invalid query parameter: end_date')

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL
    const headers = { 'Cache-Control': `public, max-age=${ttl}` }
    const ckey = `hist_t_${channelId ?? 'None'}_${computeUserIdsKey(userIds)}_${endRaw ?? 'None'}`
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = []
    const filters = ['is_bot = FALSE']
    addChannelScopeFilter(params, filters, 'channel_id', scope)
    if (endDate) {
      params.push(endDate)
      filters.push(`created_at <= $${params.length}`)
    }
    const where = filters.join(' AND ')

    const { rows: tRows } = await pool.query(
      `SELECT DATE(created_at) as d, count(*) as c FROM messages WHERE ${where} GROUP BY DATE(created_at)`,
      params,
    )
    const lineWhere = where
      .replaceAll('channel_id', 'm.channel_id')
      .replaceAll('created_at', 'm.created_at')
    const { rows: topU } = await pool.query(
      `SELECT m.user_id, count(*) as c FROM messages m LEFT JOIN users u ON m.user_id = u.user_id WHERE ${lineWhere} AND ${DELETED_USER_FILTER} GROUP BY m.user_id ORDER BY c DESC LIMIT 100`,
      params,
    )

    const targetIds = topU.map((row) => String(row.user_id))
    for (const uid of userIds) {
      if (/^\d+$/.test(uid) && !targetIds.includes(uid)) targetIds.push(uid)
    }

    const dataMap = new Map<string, Record<string, unknown>>()
    for (const row of tRows) {
      const date = String(row.d)
      dataMap.set(date, { date, total: Number(row.c) })
    }
    const uDetails: Record<string, Record<string, unknown>> = {}
    if (targetIds.length > 0) {
      const detailParams = [...params, targetIds]
      const { rows } = await pool.query(
        `SELECT DATE(created_at) as d, user_id, count(*) as c FROM messages WHERE ${where} AND user_id = ANY($${detailParams.length}::bigint[]) GROUP BY DATE(created_at), user_id`,
        detailParams,
      )
      for (const row of rows) {
        const date = String(row.d)
        if (!dataMap.has(date)) dataMap.set(date, { date, total: 0 })
        dataMap.get(date)![String(row.user_id)] = Number(row.c)
      }
      const { rows: uRows } = await pool.query(
        'SELECT user_id, display_name, username, avatar_url FROM users WHERE user_id = ANY($1::bigint[])',
        [targetIds],
      )
      for (const row of uRows) {
        uDetails[String(row.user_id)] = {
          name: row.display_name,
          username: row.username,
          avatar: row.avatar_url,
        }
      }
    }

    const chartData = [...dataMap.values()].sort((a, b) =>
      String(a.date) < String(b.date) ? -1 : String(b.date) < String(a.date) ? 1 : 0,
    )
    const res = {
      chart_data: chartData,
      users: uDetails,
      top_user_id: topU.length > 0 ? String(topU[0].user_id) : null,
    }
    cache.set(ckey, res, ttl)
    return jsonResponse(res, 200, headers)
  })

  app.get('/stats/heatmap/:year/:month', async (c) => {
    const year = pathInt(c.req.param('year'))
    const month = pathInt(c.req.param('month'))
    if (year === null || month === null) return jsonError(422, 'Invalid path parameter')

    const access = requireMonthAccess(c, year, month)
    if ('error' in access) return access.error

    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null

    const ckey = `heat_m_${year}_${month}_${channelId ?? 'None'}`
    const headers = monthCacheControl(access.isRestricted)
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const bounds = monthBounds(year, month)
    if (!Array.isArray(bounds)) return jsonError(400, bounds)
    const [startDate, endDate] = bounds

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = [startDate, endDate]
    const filters = ['created_at >= $1', 'created_at < $2', 'is_bot = FALSE']
    addChannelScopeFilter(params, filters, 'channel_id', scope)

    const { rows } = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as hour, count(*) as count FROM messages WHERE ${filters.join(' AND ')} GROUP BY dow, hour`,
      params,
    )
    const res = rows.map((row) => ({
      dow: Number(row.dow),
      hour: Number(row.hour),
      count: Number(row.count),
    }))
    cache.set(ckey, res, 600)
    return jsonResponse(res, 200, headers)
  })

  app.get('/stats/heatmap/total', async (c) => {
    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null
    const endRaw = c.req.query('end_date')
    const endDate = parseEndDate(endRaw)
    if (endDate === 'invalid') return jsonError(422, 'Invalid query parameter: end_date')

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL
    const headers = { 'Cache-Control': `public, max-age=${ttl}` }
    const ckey = `heat_t_${channelId ?? 'None'}_${endRaw ?? 'None'}`
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = []
    const filters = ['is_bot = FALSE']
    addChannelScopeFilter(params, filters, 'channel_id', scope)
    if (endDate) {
      params.push(endDate)
      filters.push(`created_at <= $${params.length}`)
    }

    const { rows } = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as hour, count(*) as count FROM messages WHERE ${filters.join(' AND ')} GROUP BY dow, hour`,
      params,
    )
    const res = rows.map((row) => ({
      dow: Number(row.dow),
      hour: Number(row.hour),
      count: Number(row.count),
    }))
    cache.set(ckey, res, ttl)
    return jsonResponse(res, 200, headers)
  })

  app.get('/stats/channels_distribution/:year/:month', async (c) => {
    const year = pathInt(c.req.param('year'))
    const month = pathInt(c.req.param('month'))
    if (year === null || month === null) return jsonError(422, 'Invalid path parameter')

    const access = requireMonthAccess(c, year, month)
    if ('error' in access) return access.error

    const ckey = `pie_m_${year}_${month}`
    const headers = monthCacheControl(access.isRestricted)
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const bounds = monthBounds(year, month)
    if (!Array.isArray(bounds)) return jsonError(400, bounds)
    const [startDate, endDate] = bounds

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const { rows } = await pool.query(
      `
      SELECT
          CASE
              WHEN c.category_id = ANY($3::bigint[]) THEN c.name
              ELSE 'プラチャ'
          END AS name,
          count(*) AS count
      FROM messages m
      JOIN channels c ON m.channel_id = c.channel_id
      WHERE m.created_at >= $1 AND m.created_at < $2 AND m.is_bot = FALSE
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
      `,
      [startDate, endDate, cfg.privateChatCategoryIds],
    )
    const res = rows.map((row) => ({ name: row.name as string, value: Number(row.count) }))
    cache.set(ckey, res, 600)
    return jsonResponse(res, 200, headers)
  })

  app.get('/stats/channels_distribution/total', async (c) => {
    const endRaw = c.req.query('end_date')
    const endDate = parseEndDate(endRaw)
    if (endDate === 'invalid') return jsonError(422, 'Invalid query parameter: end_date')

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL
    const headers = { 'Cache-Control': `public, max-age=${ttl}` }
    const ckey = `pie_t_${endRaw ?? 'None'}`
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const params: unknown[] = [cfg.privateChatCategoryIds]
    const filters = ['m.is_bot = FALSE']
    if (endDate) {
      params.push(endDate)
      filters.push(`m.created_at <= $${params.length}`)
    }

    const { rows } = await pool.query(
      `
      SELECT
          CASE
              WHEN c.category_id = ANY($1::bigint[]) THEN c.name
              ELSE 'プラチャ'
          END AS name,
          count(*) AS count
      FROM messages m
      JOIN channels c ON m.channel_id = c.channel_id
      WHERE ${filters.join(' AND ')}
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
      `,
      params,
    )
    const res = rows.map((row) => ({ name: row.name as string, value: Number(row.count) }))
    cache.set(ckey, res, ttl)
    return jsonResponse(res, 200, headers)
  })

  app.get('/stats/analysis/:year/:month', async (c) => {
    const year = pathInt(c.req.param('year'))
    const month = pathInt(c.req.param('month'))
    if (year === null || month === null) return jsonError(422, 'Invalid path parameter')

    const access = requireMonthAccess(c, year, month)
    if ('error' in access) return access.error

    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null
    const userParam = c.req.query('user_id')
    if (userParam !== undefined && userParam.length > 20) {
      return jsonError(422, 'Invalid query parameter: user_id')
    }

    const ckey = `ana_m_${year}_${month}_${channelId ?? 'None'}_${userParam ?? 'None'}`
    const headers = monthCacheControl(access.isRestricted)
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const bounds = monthBounds(year, month)
    if (!Array.isArray(bounds)) return jsonError(400, bounds)
    const [startDate, endDate] = bounds

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = [startDate, endDate]
    const filters = ['created_at >= $1', 'created_at < $2', 'is_bot = FALSE']
    addChannelScopeFilter(params, filters, 'channel_id', scope)
    if (userParam && /^\d+$/.test(userParam)) {
      params.push(userParam)
      filters.push(`user_id = $${params.length}`)
    }
    const where = filters.join(' AND ')

    const { rows: countRows } = await pool.query(
      `SELECT count(*) as total FROM messages WHERE ${where}`,
      params,
    )
    const total = Number(countRows[0]?.total ?? 0)
    if (total === 0) return jsonResponse({ total: 0 }, 200, headers)

    const uniqueWhere = where
      .replaceAll('channel_id', 'm.channel_id')
      .replaceAll('created_at', 'm.created_at')
      .replaceAll('is_bot', 'm.is_bot')
      .replaceAll('user_id', 'm.user_id')
    const { rows: uniqueRows } = await pool.query(
      `
      SELECT count(DISTINCT m.user_id) AS unique_users
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.user_id
      WHERE ${uniqueWhere}
        AND ${DELETED_USER_FILTER}
      `,
      params,
    )
    const uniqueUsers = Number(uniqueRows[0]?.unique_users ?? 0)

    const { rows: maxDRows } = await pool.query(
      `SELECT DATE(created_at AT TIME ZONE 'Asia/Tokyo') as d, count(*) as c FROM messages WHERE ${where} GROUP BY d ORDER BY c DESC LIMIT 1`,
      params,
    )
    const { rows: maxWRows } = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, count(*) as c FROM messages WHERE ${where} GROUP BY dow ORDER BY c DESC LIMIT 1`,
      params,
    )
    const { rows: maxHRows } = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as h, count(*) as c FROM messages WHERE ${where} GROUP BY h ORDER BY c DESC LIMIT 1`,
      params,
    )

    const res = {
      total,
      unique_users: uniqueUsers,
      max_date: maxDRows[0] ? { date: String(maxDRows[0].d), count: Number(maxDRows[0].c) } : null,
      max_dow: maxWRows[0] ? { dow: Number(maxWRows[0].dow), count: Number(maxWRows[0].c) } : null,
      max_hour: maxHRows[0] ? { hour: Number(maxHRows[0].h), count: Number(maxHRows[0].c) } : null,
    }
    cache.set(ckey, res, 600)
    return jsonResponse(res, 200, headers)
  })

  app.get('/stats/analysis/total', async (c) => {
    const channelParam = c.req.query('channel_id')
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, 'Invalid query parameter: channel_id')
    }
    const channelId = channelParam ?? null
    const userParam = c.req.query('user_id')
    if (userParam !== undefined && userParam.length > 20) {
      return jsonError(422, 'Invalid query parameter: user_id')
    }
    const endRaw = c.req.query('end_date')
    const endDate = parseEndDate(endRaw)
    if (endDate === 'invalid') return jsonError(422, 'Invalid query parameter: end_date')

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL
    const headers = { 'Cache-Control': `public, max-age=${ttl}` }
    const ckey = `ana_t_${channelId ?? 'None'}_${userParam ?? 'None'}_${endRaw ?? 'None'}`
    const cached = cache.get(ckey)
    if (cached !== undefined) return jsonResponse(cached, 200, headers)

    const pool = deps.getPool()
    if (!pool) return jsonError(503, 'Service unavailable.')
    const scope = await getChannelScopeIds(pool, channelId)
    if (scope instanceof Response) return scope

    const params: unknown[] = []
    const filters = ['is_bot = FALSE']
    addChannelScopeFilter(params, filters, 'channel_id', scope)
    if (userParam && /^\d+$/.test(userParam)) {
      params.push(userParam)
      filters.push(`user_id = $${params.length}`)
    }
    if (endDate) {
      params.push(endDate)
      filters.push(`created_at <= $${params.length}`)
    }
    const where = filters.join(' AND ')

    const { rows: countRows } = await pool.query(
      `SELECT count(*) as total FROM messages WHERE ${where}`,
      params,
    )
    const total = Number(countRows[0]?.total ?? 0)
    if (total === 0) return jsonResponse({ total: 0 }, 200, headers)

    const uniqueWhere = where
      .replaceAll('channel_id', 'm.channel_id')
      .replaceAll('created_at', 'm.created_at')
      .replaceAll('is_bot', 'm.is_bot')
      .replaceAll('user_id', 'm.user_id')
    const { rows: uniqueRows } = await pool.query(
      `
      SELECT count(DISTINCT m.user_id) AS unique_users
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.user_id
      WHERE ${uniqueWhere}
        AND ${DELETED_USER_FILTER}
      `,
      params,
    )
    const uniqueUsers = Number(uniqueRows[0]?.unique_users ?? 0)

    const { rows: maxDRows } = await pool.query(
      `SELECT DATE(created_at AT TIME ZONE 'Asia/Tokyo') as d, count(*) as c FROM messages WHERE ${where} GROUP BY d ORDER BY c DESC LIMIT 1`,
      params,
    )
    const { rows: maxWRows } = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, count(*) as c FROM messages WHERE ${where} GROUP BY dow ORDER BY c DESC LIMIT 1`,
      params,
    )
    const { rows: maxHRows } = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as h, count(*) as c FROM messages WHERE ${where} GROUP BY h ORDER BY c DESC LIMIT 1`,
      params,
    )

    const res = {
      total,
      unique_users: uniqueUsers,
      max_date: maxDRows[0] ? { date: String(maxDRows[0].d), count: Number(maxDRows[0].c) } : null,
      max_dow: maxWRows[0] ? { dow: Number(maxWRows[0].dow), count: Number(maxWRows[0].c) } : null,
      max_hour: maxHRows[0] ? { hour: Number(maxHRows[0].h), count: Number(maxHRows[0].c) } : null,
    }
    cache.set(ckey, res, ttl)
    return jsonResponse(res, 200, headers)
  })

  return app
}

function parseEndDate(raw: string | undefined): Date | null | 'invalid' {
  if (!raw) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/
  let normalized = raw
  if (dateOnly.test(normalized)) {
    // Python版と同じく日付のみ指定はUTCの0時と解釈する
    normalized = `${normalized}T00:00:00Z`
  } else if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    // タイムゾーン無指定はUTCと解釈する (コンテナのTZ=UTCと同じ挙動)
    normalized = `${normalized}Z`
  }
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(normalized)) {
    return 'invalid'
  }
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return 'invalid'
  return parsed
}

/**
 * 全期間統計のキャッシュを定期加温する (Python版 warm_total_cache_loop 相当)。
 * ルートハンドラ自身を app.request() で呼ぶため、キャッシュキー・TTLは
 * 実リクエストと完全に一致する。
 */
export function startWarmLoop(app: Hono<AppEnv>): () => void {
  const targets = [
    { name: 'ranking_total', path: '/ranking/total' },
    { name: 'history_total', path: '/stats/history/total' },
    { name: 'heatmap_total', path: '/stats/heatmap/total' },
    { name: 'channels_total', path: '/stats/channels_distribution/total' },
    { name: 'analysis_total', path: '/stats/analysis/total' },
  ]

  let interval: NodeJS.Timeout | null = null
  let stopped = false

  const warmOnce = async (): Promise<void> => {
    for (const target of targets) {
      const started = performance.now()
      try {
        const response = await app.request(target.path)
        const elapsedMs = Math.round(performance.now() - started)
        if (response.ok) {
          console.log(`${new Date().toISOString()} [INFO] ymkw-api: Warmed cache: ${target.name} (${elapsedMs}ms)`)
        } else {
          console.warn(
            `${new Date().toISOString()} [WARN] ymkw-api: Failed to warm cache: ${target.name} status=${response.status}`,
          )
        }
      } catch (error) {
        console.warn(
          `${new Date().toISOString()} [WARN] ymkw-api: Failed to warm cache: ${target.name}`,
          error,
        )
      }
    }
  }

  const schedule = setTimeout(() => {
    if (stopped) return
    void warmOnce()
    interval = setInterval(() => {
      if (!stopped) void warmOnce()
    }, TOTAL_CACHE_WARM_INTERVAL_MS)
  }, 10_000)

  return () => {
    stopped = true
    clearTimeout(schedule)
    if (interval) clearInterval(interval)
  }
}
