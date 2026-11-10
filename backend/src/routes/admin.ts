import type { Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Pool } from "pg";
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
} from "../adminAuth";
import {
  DELETED_USER_FILTER,
  LIVE_TOTAL_CACHE_TTL,
  TOTAL_CACHE_WARM_INTERVAL_MS,
  addChannelScopeFilter,
  computeUserIdsKey,
  escapeLike,
  formatRankingResponse,
  formatUserRankResponse,
  jsonResponse,
  jsonError,
  monthBounds,
  noContent,
  parseEndDate,
  pathInt,
  plainTextResponse,
  readBodyCapped,
} from "../http";
import { dashboardBaseUrl, normalizeHost } from "../guilds";
import type { AppEnv } from "../types";
import type { RouteHelpers } from "./context";

/** 管理 (/admin/*) */
export function register(app: Hono<AppEnv>, h: RouteHelpers): void {
  const { cfg, cache, deps, getPeerIp, requireGuild, getChannelScopeIds, requireMonthAccess, monthCacheControl, adminRequestHost } = h;

  app.get("/admin/session", (c) => {
    // 読み取り専用プローブのためOriginチェックは不要 (CookieはSameSite=Lax)。
    if (!verifyAdminSession(getCookie(c, ADMIN_COOKIE_NAME), cfg.adminSessionSecret)) {
      return jsonError(401, "Not authenticated.");
    }
    return noContent({ "Cache-Control": "no-store" });
  });

  app.post("/admin/login", async (c) => {
    if (!adminOriginAllowed(c.req.header("origin"), adminRequestHost(c), cfg.allowedOrigins)) {
      return jsonError(403, "Invalid origin.");
    }
    const clientIp = getPeerIp(c);
    const clientKey = adminClientKey(clientIp, cfg.adminSessionSecret);
    const ipTag = clientKey.slice(0, 12);
    const pool = deps.getPool();
    if (!pool) {
      return jsonError(503, "Login service unavailable.");
    }
    let allowed: boolean;
    try {
      allowed = await deps.consumeLoginLimits(
        pool,
        clientKey,
        ADMIN_LOGIN_LIMIT,
        cfg.adminLoginGlobalLimit,
        ADMIN_LOGIN_WINDOW,
      );
    } catch (error) {
      console.error("admin_login outcome=limiter_unavailable", error);
      return jsonError(503, "Login service unavailable.");
    }
    if (!allowed) {
      console.warn(`admin_login outcome=rate_limited client=${ipTag}`);
      return jsonError(429, "Too many login attempts.", {
        "Retry-After": String(ADMIN_LOGIN_WINDOW),
      });
    }

    const body = await readBodyCapped(c.req.raw, 2048);
    if (body === null) {
      return jsonError(413, "Request body too large.");
    }
    let password = "";
    try {
      const payload: unknown = JSON.parse(body.toString("utf8"));
      if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
        const candidate = (payload as { password?: unknown }).password;
        if (typeof candidate === "string") password = candidate;
      }
    } catch {
      return jsonError(400, "Invalid request body.");
    }

    if (!(await deps.verifyAdminPassword(password, cfg.adminPasswordHash))) {
      console.warn(`admin_login outcome=invalid_password client=${ipTag}`);
      return jsonError(401, "Invalid password.");
    }
    console.info(`admin_login outcome=success client=${ipTag}`);

    return noContent({
      "Cache-Control": "no-store",
      "Set-Cookie": adminSessionCookie(
        createAdminSession(cfg.adminSessionSecret, Math.floor(Date.now() / 1000)),
      ),
    });
  });

  app.post("/admin/logout", (c) => {
    if (!adminOriginAllowed(c.req.header("origin"), adminRequestHost(c), cfg.allowedOrigins)) {
      return jsonError(403, "Invalid origin.");
    }
    return noContent({
      "Cache-Control": "no-store",
      "Set-Cookie": adminSessionCookieDeletion(),
    });
  });
}
