import { createHmac, pbkdf2, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const pbkdf2Async = promisify(pbkdf2) as (
  password: string,
  salt: Buffer,
  iterations: number,
  keylen: number,
  digest: string,
) => Promise<Buffer>

export const ADMIN_COOKIE_NAME = '__Secure-ymkw_admin'
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24
export const ADMIN_LOGIN_WINDOW = 10 * 60
export const ADMIN_LOGIN_LIMIT = 5
export const ADMIN_COOKIE_DOMAIN = '.ymkw.top'

function hmacSha256Base64Url(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url')
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** HMAC-SHA256署名入り管理セッショントークンを発行する */
export function createAdminSession(secret: string, nowSeconds: number): string {
  const payload = `v1.${nowSeconds + ADMIN_SESSION_MAX_AGE}`
  return `${payload}.${hmacSha256Base64Url(secret, payload)}`
}

/** 管理セッショントークンを検証する (期限・形式・署名) */
export function verifyAdminSession(
  token: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [version, expiresRaw, suppliedSignature] = parts
  if (version !== 'v1' || expiresRaw.length !== 10 || !/^\d{10}$/.test(expiresRaw)) {
    return false
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)) return false
  const expiresAt = Number(expiresRaw)
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + ADMIN_SESSION_MAX_AGE + 60) {
    return false
  }
  const payload = `${version}.${expiresRaw}`
  return safeCompare(suppliedSignature, hmacSha256Base64Url(secret, payload))
}

/** 管理パスワードをPBKDF2-SHA256ハッシュと照合する (イベントループをブロックしない) */
export async function verifyAdminPassword(
  password: string,
  adminPasswordHash: string,
): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0 || password.length > 256) {
    return false
  }
  const parts = adminPasswordHash.split('$')
  if (parts.length !== 4) return false
  const [, iterationsRaw, saltRaw, hashRaw] = parts
  if (iterationsRaw !== '600000') return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltRaw, 'base64url')
    expected = Buffer.from(hashRaw, 'base64url')
  } catch {
    return false
  }
  if (salt.length !== 16 || expected.length !== 32) return false
  const actual = await pbkdf2Async(password, salt, 600000, 32, 'sha256')
  return timingSafeEqual(actual, expected)
}

/** ログインリミッタ用のクライアントキー (IPのHMAC) */
export function adminClientKey(clientIp: string, secret: string): string {
  return createHmac('sha256', secret).update(clientIp, 'utf8').digest('hex')
}

/** 管理系エンドポイントのOrigin検証 */
export function adminOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  return origin !== undefined && allowedOrigins.includes(origin)
}

/** X-API-KEY によるBot/APIクライアント判定 (timing-safe比較) */
export function isApiClient(suppliedKey: string | undefined, apiSecret: string): boolean {
  if (!suppliedKey) return false
  return safeCompare(suppliedKey, apiSecret)
}

export function adminSessionCookie(token: string): string {
  return `${ADMIN_COOKIE_NAME}=${token}; Path=/; Domain=${ADMIN_COOKIE_DOMAIN}; Max-Age=${ADMIN_SESSION_MAX_AGE}; Secure; HttpOnly; SameSite=Lax`
}

export function adminSessionCookieDeletion(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; Domain=${ADMIN_COOKIE_DOMAIN}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax`
}
