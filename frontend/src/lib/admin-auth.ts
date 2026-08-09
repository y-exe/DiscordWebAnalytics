import { env } from "cloudflare:workers";

export const ADMIN_COOKIE_NAME = "__Secure-ymkw_admin";
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24;
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 5;
const PBKDF2_ITERATIONS = 600_000;

const encoder = new TextEncoder();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function getSecret(name: "ADMIN_PASSWORD_HASH" | "ADMIN_SESSION_SECRET"): string {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function parsePasswordHash(value: string): { salt: Uint8Array; hash: Uint8Array } | null {
  const match = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/u.exec(value);
  if (!match || Number(match[1]) !== PBKDF2_ITERATIONS) return null;
  try {
    const salt = base64UrlToBytes(match[2]);
    const hash = base64UrlToBytes(match[3]);
    return salt.length === 16 && hash.length === 32 ? { salt, hash } : null;
  } catch {
    return null;
  }
}

async function derivePasswordHash(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

export function isAdminAuthConfigured(): boolean {
  return parsePasswordHash(getSecret("ADMIN_PASSWORD_HASH")) !== null && getSecret("ADMIN_SESSION_SECRET").length >= 32;
}

export function canAttemptAdminLogin(clientKey: string, now = Date.now()): boolean {
  const attempt = loginAttempts.get(clientKey);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.delete(clientKey);
    return true;
  }
  return attempt.count < LOGIN_ATTEMPT_LIMIT;
}

export function recordAdminLoginFailure(clientKey: string, now = Date.now()): void {
  const current = loginAttempts.get(clientKey);
  const next = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + LOGIN_ATTEMPT_WINDOW_MS }
    : { count: current.count + 1, resetAt: current.resetAt };
  loginAttempts.set(clientKey, next);

  if (loginAttempts.size > 5000) {
    for (const [key, attempt] of loginAttempts) {
      if (attempt.resetAt <= now || loginAttempts.size > 5000) loginAttempts.delete(key);
    }
  }
}

export function clearAdminLoginFailures(clientKey: string): void {
  loginAttempts.delete(clientKey);
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const stored = parsePasswordHash(getSecret("ADMIN_PASSWORD_HASH"));
  if (!stored || password.length === 0 || password.length > 256) return false;
  return timingSafeEqual(bytesToBase64Url(await derivePasswordHash(password, stored.salt)), bytesToBase64Url(stored.hash));
}

export async function createAdminSession(now = Date.now()): Promise<string> {
  const secret = getSecret("ADMIN_SESSION_SECRET");
  if (secret.length < 32) throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters");

  const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_MAX_AGE;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifyAdminSession(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const secret = getSecret("ADMIN_SESSION_SECRET");
  if (secret.length < 32) return false;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^\d{10}$/u.test(parts[1])) return false;

  const expiresAt = Number(parts[1]);
  const nowSeconds = Math.floor(now / 1000);
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + ADMIN_SESSION_MAX_AGE + 60) return false;

  const expectedSignature = await sign(`${parts[0]}.${parts[1]}`, secret);
  return timingSafeEqual(parts[2], expectedSignature);
}
