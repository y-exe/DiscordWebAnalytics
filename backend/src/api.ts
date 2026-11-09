import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Pool } from "pg";
import {
  buildAllTimeRankingComponent,
  buildRankingComponent,
  monthlyRankingTitle,
  rankingComponentNotes,
  serializeComponentEmbed,
  type RankingRow,
} from "../../shared/discord-ranking";
import { monthlyRankingQuery } from "../../shared/monthly-ranking";
import { totalRankingQuery } from "../../shared/total-ranking";
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
} from "./adminAuth";
import { getClientIp } from "./config";
import type { AppConfig } from "./config";
import { dashboardBaseUrl, normalizeHost, resolveGuildByHost, type GuildContext } from "./guilds";

export const PUBLIC_PATHS = new Set(["/", "/health", "/docs", "/openapi.json", "/favicon.ico"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DB_HEAVY_PREFIXES = ["/ranking", "/stats", "/users", "/graph"];
const LIVE_TOTAL_CACHE_TTL = 1800;
export const TOTAL_CACHE_WARM_INTERVAL_MS = 600 * 1000;

const DELETED_USER_FILTER =
  "(u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND u.display_name NOT ILIKE 'deleted%user')";

export interface AppDeps {
  config: AppConfig;
  cache: {
    get(key: string): unknown;
    set(key: string, value: unknown, expire?: number): void;
    consumeLimit(key: string, limit: number, window: number): boolean;
  };
  getPool: () => Pool | null;
  consumeLoginLimits: (
    pool: Pool,
    clientKey: string,
    perClient: number,
    total: number,
    window: number,
  ) => Promise<boolean>;
  verifyAdminPassword: (password: string, hash: string) => Promise<boolean>;
  getPeerIp?: (c: Context) => string;
}

type AppEnv = { Bindings: { peerIp?: string; trustedPeer?: boolean } };
export type { AppEnv };

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  if (headers) {
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function jsonError(status: number, message: string, headers?: Record<string, string>): Response {
  return jsonResponse({ detail: message }, status, headers);
}

function plainTextResponse(text: string, headers?: Record<string, string>, status = 200): Response {
  const responseHeaders = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  if (headers) {
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
  }
  return new Response(text, { status, headers: responseHeaders });
}

function noContent(headers?: Record<string, string>): Response {
  const responseHeaders = new Headers();
  if (headers) {
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
  }
  return new Response(null, { status: 204, headers: responseHeaders });
}

function defaultGetPeerIp(c: Context): string {
  return (c.env as { peerIp?: string } | undefined)?.peerIp ?? "unknown";
}

async function readBodyCapped(request: Request, cap: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function pathInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function jstYearMonth(date = new Date()): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).format(date);
  const [year, month] = formatted.split("-").map(Number);
  return { year, month };
}

interface RankingItem {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  avatar_decoration: string | null;
  nameplate: { asset: string; palette: string } | null;
  primary_guild_tag: string | null;
  primary_guild_badge: string | null;
  count: number;
  char_count: number;
}

interface UserRankItem extends RankingItem {
  rank: number;
}

interface QueryRow {
  [column: string]: unknown;
}

function formatRankingResponse(rows: QueryRow[]): RankingItem[] {
  return rows.map((row) => ({
    user_id: String(row.user_id),
    display_name: (row.display_name as string) || "Unknown",
    username: (row.username as string) || "unknown",
    avatar: (row.avatar_url as string | null) ?? null,
    avatar_decoration: (row.avatar_decoration_url as string | null) ?? null,
    nameplate: (row.nameplate_asset as string | null)
      ? {
          asset: row.nameplate_asset as string,
          palette: (row.nameplate_palette as string | null) ?? "white",
        }
      : null,
    primary_guild_tag: (row.primary_guild_tag as string | null) ?? null,
    primary_guild_badge: (row.primary_guild_badge_url as string | null) ?? null,
    count: Number(row.c),
    char_count: Number(row.chars || 0),
  }));
}

function formatUserRankResponse(row: QueryRow | undefined): UserRankItem | null {
  if (!row) return null;
  return {
    user_id: String(row.user_id),
    display_name: (row.display_name as string) || "Unknown",
    username: (row.username as string) || "unknown",
    avatar: (row.avatar_url as string | null) ?? null,
    avatar_decoration: (row.avatar_decoration_url as string | null) ?? null,
    nameplate: (row.nameplate_asset as string | null)
      ? {
          asset: row.nameplate_asset as string,
          palette: (row.nameplate_palette as string | null) ?? "white",
        }
      : null,
    primary_guild_tag: (row.primary_guild_tag as string | null) ?? null,
    primary_guild_badge: (row.primary_guild_badge_url as string | null) ?? null,
    count: Number(row.c),
    char_count: Number(row.chars || 0),
    rank: Number(row.rank),
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function monthBounds(year: number, month: number): Date[] | string {
  if (year < 2020 || year > 2100) return "year must be between 2020 and 2100";
  if (month < 1 || month > 12) return "month must be between 1 and 12";
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end =
    month === 12 ? new Date(Date.UTC(year + 1, 0, 1)) : new Date(Date.UTC(year, month, 1));
  return [start, end];
}

function isDbHeavyPath(path: string): boolean {
  return DB_HEAVY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function addChannelScopeFilter(
  params: unknown[],
  filters: string[],
  column: string,
  channelIds: string[] | null,
): void {
  if (channelIds !== null) {
    params.push(channelIds);
    filters.push(`${column} = ANY($${params.length}::bigint[])`);
  }
}

function computeUserIdsKey(userIds: string[]): string {
  return userIds.length === 0 ? "None" : JSON.stringify(userIds);
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const cfg = deps.config;
  const cache = deps.cache;
  const getPeerIp = deps.getPeerIp ?? defaultGetPeerIp;

  async function getChannelScopeIds(
    pool: Pool,
    guild: GuildContext,
    channelId: string | null,
  ): Promise<string[] | null | Response> {
    if (!channelId) return null;
    const { whitelistChannelIds, privateChatChannelId, privateChatCategoryIds } =
      guild.displayConfig;
    const isPrivateChat = channelId === privateChatChannelId && privateChatCategoryIds.length > 0;

    if (isPrivateChat) {
      const { rows } = await pool.query(
        `
        SELECT channel_id
        FROM channels
        WHERE guild_id = $2 AND is_active = TRUE
          AND (
              (category_id IS NULL AND category_name = '未分類')
              OR (category_id IS NOT NULL AND NOT (category_id = ANY($1::bigint[])))
          )
        `,
        [privateChatCategoryIds, guild.guildId],
      );
      return rows.map((row) => String(row.channel_id));
    }

    if (whitelistChannelIds.length > 0) {
      if (!whitelistChannelIds.includes(channelId)) {
        return jsonError(404, "Channel not found");
      }
    } else {
      // ホワイトリスト未設定のギルドは自ギルドの全チャンネルを対象にする
      const { rows } = await pool.query(
        "SELECT 1 FROM channels WHERE channel_id = $1 AND guild_id = $2 LIMIT 1",
        [channelId, guild.guildId],
      );
      if (rows.length === 0) return jsonError(404, "Channel not found");
    }

    const { rows: channelRows } = await pool.query(
      "SELECT name FROM channels WHERE channel_id = $1 AND guild_id = $2",
      [channelId, guild.guildId],
    );
    if (channelRows.length === 0) return [channelId];

    const childPrefix = `${escapeLike(channelRows[0].name as string)} / %`;
    const { rows } = await pool.query(
      `
      SELECT channel_id
      FROM channels
      WHERE guild_id = $3 AND (channel_id = $1 OR name LIKE $2 ESCAPE '\\')
      `,
      [channelId, childPrefix, guild.guildId],
    );
    return rows.length > 0 ? rows.map((row) => String(row.channel_id)) : [channelId];
  }

  /** Hostヘッダー (またはx-forwarded-host) からリクエスト対象ギルドを解決する */
  async function requireGuild(c: Context): Promise<GuildContext | Response> {
    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    // SSR (フロントエンドサーバー) はオリジンページのホストをx-forwarded-hostで伝える
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
    const guild = await resolveGuildByHost(pool, cfg, host);
    if (!guild) return jsonError(404, "Unknown guild host.");
    return guild;
  }

  function requireMonthAccess(
    c: Context,
    year: number,
    month: number,
  ): { isRestricted: boolean } | { error: Response } {
    const now = jstYearMonth();
    const isRestricted = year > now.year || (year === now.year && month >= now.month);
    if (
      isRestricted &&
      !isApiClient(c.req.header("x-api-key"), cfg.apiSecret) &&
      !verifyAdminSession(getCookie(c, ADMIN_COOKIE_NAME), cfg.adminSessionSecret)
    ) {
      return { error: jsonError(403, "This month's report is not public yet.") };
    }
    return { isRestricted };
  }

  const monthCacheControl = (isRestricted: boolean): Record<string, string> =>
    isRestricted
      ? { "Cache-Control": "private, no-store" }
      : { "Cache-Control": "public, max-age=600" };

  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: cfg.allowedOrigins,
      credentials: true,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Accept", "Content-Type"],
      exposeHeaders: ["X-Debug-Block"],
    }),
  );

  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const isBot = isApiClient(c.req.header("x-api-key"), cfg.apiSecret);
    const path = c.req.path;
    const isPublicPath = PUBLIC_PATHS.has(path);

    if (
      WRITE_METHODS.has(c.req.method) &&
      !isBot &&
      !isPublicPath &&
      path !== "/admin/login" &&
      path !== "/admin/logout"
    ) {
      return jsonResponse({ detail: "API key required." }, 401, {
        "X-Debug-Block": "write-api-key-required",
      });
    }

    const clientIp = getClientIp(
      getPeerIp(c),
      c.req.header("CF-Connecting-IP"),
      cfg.trustCloudflareProxy,
      cfg.cloudflareTrustedProxyCidrs,
      Boolean(c.env?.trustedPeer),
    );

    const blockKey = `blocked:${clientIp}`;
    if (cache.get(blockKey)) {
      return jsonResponse({ detail: "Too Many Requests. Blocked for 10 minutes." }, 429, {
        "X-Debug-Block": "rate-limit-active",
      });
    }

    const requestLimit = isBot ? cfg.botMaxRequests : cfg.maxRequests;
    if (!cache.consumeLimit(`request:${clientIp}`, requestLimit, cfg.rateLimitWindow)) {
      cache.set(blockKey, true, cfg.blockDuration);
      return jsonResponse({ detail: "Too Many Requests. Blocked for 10 minutes." }, 429, {
        "X-Debug-Block": "rate-limit-exceeded",
      });
    }

    if (!isPublicPath && isDbHeavyPath(path)) {
      const dbLimit = isBot ? cfg.dbBotMaxRequests : cfg.dbMaxRequests;
      if (!cache.consumeLimit(`db:${clientIp}`, dbLimit, cfg.dbRateLimitWindow)) {
        cache.set(blockKey, true, cfg.blockDuration);
        return jsonResponse({ detail: "Too Many Requests. Blocked for 10 minutes." }, 429, {
          "X-Debug-Block": "db-rate-limit-exceeded",
        });
      }
    }

    try {
      await next();
      c.res.headers.set("X-Content-Type-Options", "nosniff");
      c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      c.res.headers.set("X-Frame-Options", "DENY");
      return;
    } catch (error) {
      console.error(`Unhandled exception during request: ${c.req.method} ${path}`, error);
      return jsonResponse(
        {
          detail: "Internal Server Error",
          error_type: error instanceof Error ? error.constructor.name : typeof error,
        },
        500,
        { "X-Debug-Block": "internal-error" },
      );
    }
  });

  app.notFound((c) => {
    return jsonResponse({ detail: "Not Found" }, 404);
  });

  app.onError((error, c) => {
    console.error(`Unhandled error: ${c.req.method} ${c.req.path}`, error);
    return jsonResponse({ detail: "Internal Server Error" }, 500);
  });

  app.get("/", (c) => plainTextResponse("ymkw.top API by yexe"));

  app.get("/health", (c) => plainTextResponse("ok"));

  if (cfg.enableApiDocs) {
    app.get("/docs", (c) =>
      plainTextResponse("API docs are enabled. See /openapi.json.", {
        "Content-Type": "text/html; charset=utf-8",
      }),
    );
    app.get("/redoc", (c) => plainTextResponse("API docs are enabled. See /openapi.json."));
    app.get("/openapi.json", (c) =>
      jsonResponse({
        openapi: "3.1.0",
        info: { title: "ymkw.top API", version: "1.0.0" },
        paths: {},
      }),
    );
  }

  app.get("/guild-context", async (c) => {
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;
    return jsonResponse(
      {
        guildId: guild.guildId,
        name: guild.name,
        iconUrl: guild.iconUrl,
        isDefault: guild.guildId === cfg.guildId,
        domain: dashboardBaseUrl(guild),
        domains: guild.domains,
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  });

  /** 管理系Origin検証用: リクエスト先ホスト (XFF > Host > URL) を取得する */
  function adminRequestHost(c: Context): string | undefined {
    const headerHost = c.req.header("x-forwarded-host") ?? c.req.header("host");
    const normalized = normalizeHost(headerHost);
    if (normalized) return normalized;
    try {
      return normalizeHost(new URL(c.req.url).host) || undefined;
    } catch {
      return undefined;
    }
  }

  app.get("/admin/session", (c) => {
    // 読み取り専用プローブのためOriginチェックは不要 (CookieはSameSite=Lax)。
    if (!verifyAdminSession(getCookie(c, ADMIN_COOKIE_NAME), cfg.adminSessionSecret)) {
      return jsonError(401, "Not authenticated.");
    }
    return noContent({ "Cache-Control": "no-store" });
  });

  app.post("/admin/login", async (c) => {
    if (
      !adminOriginAllowed(c.req.header("origin"), adminRequestHost(c), cfg.allowedOrigins)
    ) {
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
    if (
      !adminOriginAllowed(c.req.header("origin"), adminRequestHost(c), cfg.allowedOrigins)
    ) {
      return jsonError(403, "Invalid origin.");
    }
    return noContent({
      "Cache-Control": "no-store",
      "Set-Cookie": adminSessionCookieDeletion(),
    });
  });

  app.get("/channels", async (c) => {
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    const headers = { "Cache-Control": "public, max-age=3600" };
    const ckey = `channels_list_${guild.guildId}`;
    const cached = cache.get(ckey);
    if (cached !== undefined && cached !== null) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const { rows } = await pool.query(
      "SELECT * FROM channels WHERE is_active = TRUE AND guild_id = $1 ORDER BY position ASC",
      [guild.guildId],
    );

    const { whitelistChannelIds, bottomChannelCategoryIds } = guild.displayConfig;
    const whitelist = new Set(whitelistChannelIds);
    const bottomCategories = new Set(bottomChannelCategoryIds);
    // ホワイトリスト未設定のギルドは全チャンネルを表示する
    const visibleRows =
      whitelist.size > 0 ? rows.filter((row) => whitelist.has(String(row.channel_id))) : rows;
    visibleRows.sort((a, b) => {
      const aBottom = a.category_id !== null && bottomCategories.has(String(a.category_id));
      const bBottom = b.category_id !== null && bottomCategories.has(String(b.category_id));
      if (aBottom !== bBottom) return aBottom ? 1 : -1;
      return (Number(a.position) || 999999) - (Number(b.position) || 999999);
    });

    const res = [
      ...(guild.displayConfig.privateChatCategoryIds.length > 0
        ? [
            {
              id: guild.displayConfig.privateChatChannelId,
              name: "プラチャ総合",
              category: "プラチャ",
            },
          ]
        : []),
      ...visibleRows.map((row) => ({
        id: String(row.channel_id),
        name: row.name as string,
        category: (row.category_name as string) || "未分類",
      })),
    ];

    cache.set(ckey, res, 3600);
    return jsonResponse(res, 200, headers);
  });

  app.get("/users/search", async (c) => {
    const q = c.req.query("q");
    if (q === undefined || q.length < 1 || q.length > 64) {
      return jsonError(422, "Query validation failed: q must be 1-64 characters");
    }
    const searchQuery = q.trim();
    if (!searchQuery) return jsonResponse([]);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const { rows } = await pool.query(
      `SELECT gm.user_id, gm.display_name, u.username, gm.avatar_url,
              u.avatar_decoration_url, u.nameplate_asset, u.nameplate_palette,
              u.primary_guild_tag, u.primary_guild_badge_url
       FROM guild_members gm
       JOIN users u ON u.user_id = gm.user_id
       WHERE gm.guild_id = $1
         AND (gm.display_name ILIKE $2 OR u.display_name ILIKE $2 OR u.username ILIKE $2)
         AND u.username NOT ILIKE 'deleted%user'
         AND gm.display_name NOT ILIKE 'deleted%user'
       LIMIT 10`,
      [guildOrError.guildId, `%${searchQuery}%`],
    );
    return jsonResponse(
      rows.map((row) => ({
        user_id: String(row.user_id),
        display_name: row.display_name,
        username: row.username,
        avatar: row.avatar_url,
        avatar_decoration: row.avatar_decoration_url ?? null,
        nameplate: row.nameplate_asset
          ? { asset: row.nameplate_asset, palette: row.nameplate_palette ?? "white" }
          : null,
        primary_guild_tag: row.primary_guild_tag ?? null,
        primary_guild_badge: row.primary_guild_badge_url ?? null,
      })),
    );
  });

  app.get("/ranking/monthly/:year/:month/discord-embed", async (c) => {
    const year = pathInt(c.req.param("year"));
    const month = pathInt(c.req.param("month"));
    if (year === null || month === null || year < 2020 || year > 2100 || month < 1 || month > 12) {
      return jsonError(422, "Invalid path parameter");
    }
    const access = requireMonthAccess(c, year, month);
    if ("error" in access) return access.error;
    // プレビューは再配布されるため、認証済みでも未公開月は返さない。
    if (access.isRestricted) return jsonError(403, "This month's report is not public yet.");
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;
    const ckey = `discord_month_${guild.guildId}_${year}_${month}`;
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    };
    const cached = cache.get(ckey);
    if (typeof cached === "string") return new Response(cached, { headers });
    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const { rows } = await pool.query(
      monthlyRankingQuery(year, month, guild.guildId, guild.excludedChannelIds),
    );
    if (!rows.length) return jsonError(404, "No ranking data.");
    const base = dashboardBaseUrl(guild);
    const component = buildRankingComponent(
      monthlyRankingTitle(year, month),
      rows as RankingRow[],
      year,
      month,
      guild.kingRoleId !== null,
      base ? `${base}/month/${year}/${month}` : undefined,
      guild.kingRoleId,
      {
        ...rankingComponentNotes(
          guild.excludedChannelIds,
          guild.displayConfig.privateChatCategoryIds,
        ),
        allUrl: base ? `${base}/all` : null,
      },
    );
    const payload = serializeComponentEmbed(component);
    if (!payload) return jsonError(413, "Component embed exceeds the 3000-byte limit.");
    cache.set(ckey, payload, 600);
    return new Response(payload, { headers });
  });

  app.get("/ranking/monthly/:year/:month", async (c) => {
    const year = pathInt(c.req.param("year"));
    const month = pathInt(c.req.param("month"));
    if (year === null || month === null) return jsonError(422, "Invalid path parameter");
    const access = requireMonthAccess(c, year, month);
    if ("error" in access) return access.error;

    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;

    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    const ckey = `rank_m_${guild.guildId}_${year}_${month}_${channelId ?? "None"}`;
    const headers = monthCacheControl(access.isRestricted);
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const bounds = monthBounds(year, month);
    if (!Array.isArray(bounds)) return jsonError(400, bounds);
    const [startDate, endDate] = bounds;

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [startDate, endDate];
    const filters = [
      "m.created_at >= $1",
      "m.created_at < $2",
      "m.is_bot = FALSE",
      DELETED_USER_FILTER,
    ];
    params.push(guild.guildId);
    filters.push(`m.guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "m.channel_id", scope);
    const query = `
      SELECT m.user_id, count(*) as c, sum(m.char_count) as chars, u.display_name, u.username, u.avatar_url, u.avatar_decoration_url, u.nameplate_asset, u.nameplate_palette, u.primary_guild_tag, u.primary_guild_badge_url
      FROM messages m LEFT JOIN users u ON m.user_id = u.user_id
      WHERE ${filters.join(" AND ")}
      GROUP BY m.user_id, u.display_name, u.username, u.avatar_url, u.avatar_decoration_url, u.nameplate_asset, u.nameplate_palette, u.primary_guild_tag, u.primary_guild_badge_url
      ORDER BY c DESC LIMIT 100`;
    const { rows } = await pool.query(query, params);
    const res = formatRankingResponse(rows);
    cache.set(ckey, res, 600);
    return jsonResponse(res, 200, headers);
  });

  app.get("/ranking/total/discord-embed", async (c) => {
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;
    const ckey = `discord_total_${guild.guildId}`;
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${LIVE_TOTAL_CACHE_TTL}`,
    };
    const cached = cache.get(ckey);
    if (typeof cached === "string") return new Response(cached, { headers });
    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const { rows } = await pool.query(totalRankingQuery(guild.guildId, guild.excludedChannelIds));
    if (!rows.length) return jsonError(404, "No ranking data.");
    const base = dashboardBaseUrl(guild);
    const payload = serializeComponentEmbed(
      buildAllTimeRankingComponent(rows as RankingRow[], {
        ...rankingComponentNotes(
          guild.excludedChannelIds,
          guild.displayConfig.privateChatCategoryIds,
        ),
        allUrl: base ? `${base}/all` : null,
      }),
    );
    if (!payload) return jsonError(413, "Component embed exceeds the 3000-byte limit.");
    cache.set(ckey, payload, LIVE_TOTAL_CACHE_TTL);
    return new Response(payload, { headers });
  });

  app.get("/ranking/total", async (c) => {
    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;
    const endRaw = c.req.query("end_date");
    const endDate = parseEndDate(endRaw);
    if (endDate === "invalid") return jsonError(422, "Invalid query parameter: end_date");

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;
    const ckey = `rank_t_${guild.guildId}_${channelId ?? "None"}_${endRaw ?? "None"}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [];
    const filters = ["m.is_bot = FALSE", DELETED_USER_FILTER];
    params.push(guild.guildId);
    filters.push(`m.guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "m.channel_id", scope);
    if (endDate) {
      params.push(endDate);
      filters.push(`m.created_at <= $${params.length}`);
    }
    const query = `
      SELECT m.user_id, count(*) as c, sum(m.char_count) as chars, u.display_name, u.username, u.avatar_url, u.avatar_decoration_url, u.nameplate_asset, u.nameplate_palette, u.primary_guild_tag, u.primary_guild_badge_url
      FROM messages m LEFT JOIN users u ON m.user_id = u.user_id
      WHERE ${filters.join(" AND ")}
      GROUP BY m.user_id, u.display_name, u.username, u.avatar_url, u.avatar_decoration_url, u.nameplate_asset, u.nameplate_palette, u.primary_guild_tag, u.primary_guild_badge_url
      ORDER BY c DESC LIMIT 100`;
    const { rows } = await pool.query(query, params);
    const res = formatRankingResponse(rows);
    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  });

  app.get("/users/:userId/rank/monthly/:year/:month", async (c) => {
    const userId = c.req.param("userId");
    if (!/^\d+$/.test(userId)) return jsonError(422, "Invalid path parameter: user_id");
    const year = pathInt(c.req.param("year"));
    const month = pathInt(c.req.param("month"));
    if (year === null || month === null) return jsonError(422, "Invalid path parameter");

    const access = requireMonthAccess(c, year, month);
    if ("error" in access) return access.error;

    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;

    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    const ckey = `user_rank_m_${guild.guildId}_${userId}_${year}_${month}_${channelId ?? "None"}`;
    const headers = monthCacheControl(access.isRestricted);
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached ?? null, 200, headers);

    const bounds = monthBounds(year, month);
    if (!Array.isArray(bounds)) return jsonError(400, bounds);
    const [startDate, endDate] = bounds;

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [startDate, endDate];
    const filters = [
      "m.created_at >= $1",
      "m.created_at < $2",
      "m.is_bot = FALSE",
      DELETED_USER_FILTER,
    ];
    params.push(guild.guildId);
    filters.push(`m.guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "m.channel_id", scope);
    params.push(userId);
    const targetParam = `$${params.length}`;

    const query = `
        WITH counts AS (
            SELECT m.user_id, count(*) AS c, sum(m.char_count) AS chars
            FROM messages m
            LEFT JOIN users u ON m.user_id = u.user_id
            WHERE ${filters.join(" AND ")}
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
            u.avatar_decoration_url,
            u.nameplate_asset,
            u.nameplate_palette,
            u.primary_guild_tag,
            u.primary_guild_badge_url,
            (SELECT count(*) + 1 FROM counts c2 WHERE c2.c > t.c)::int AS rank
        FROM target t
        LEFT JOIN users u ON t.user_id = u.user_id
    `;
    const { rows } = await pool.query(query, params);
    const res = formatUserRankResponse(rows[0]);
    cache.set(ckey, res, 600);
    return jsonResponse(res, 200, headers);
  });

  app.get("/users/:userId/rank/total", async (c) => {
    const userId = c.req.param("userId");
    if (!/^\d+$/.test(userId)) return jsonError(422, "Invalid path parameter: user_id");
    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;
    const endRaw = c.req.query("end_date");
    const endDate = parseEndDate(endRaw);
    if (endDate === "invalid") return jsonError(422, "Invalid query parameter: end_date");

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;
    const ckey = `user_rank_t_${guild.guildId}_${userId}_${channelId ?? "None"}_${endRaw ?? "None"}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached ?? null, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [];
    const filters = ["m.is_bot = FALSE", DELETED_USER_FILTER];
    params.push(guild.guildId);
    filters.push(`m.guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "m.channel_id", scope);
    if (endDate) {
      params.push(endDate);
      filters.push(`m.created_at <= $${params.length}`);
    }
    params.push(userId);
    const targetParam = `$${params.length}`;

    const query = `
        WITH counts AS (
            SELECT m.user_id, count(*) AS c, sum(m.char_count) AS chars
            FROM messages m
            LEFT JOIN users u ON m.user_id = u.user_id
            WHERE ${filters.join(" AND ")}
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
            u.avatar_decoration_url,
            u.nameplate_asset,
            u.nameplate_palette,
            u.primary_guild_tag,
            u.primary_guild_badge_url,
            (SELECT count(*) + 1 FROM counts c2 WHERE c2.c > t.c)::int AS rank
        FROM target t
        LEFT JOIN users u ON t.user_id = u.user_id
    `;
    const { rows } = await pool.query(query, params);
    const res = formatUserRankResponse(rows[0]);
    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  });

  app.get("/stats/history/:year/:month", async (c) => {
    const year = pathInt(c.req.param("year"));
    const month = pathInt(c.req.param("month"));
    if (year === null || month === null) return jsonError(422, "Invalid path parameter");

    const userIds = c.req.queries("user_id") ?? [];
    if (userIds.length > 5) {
      return jsonError(400, "At most 5 user_id values are allowed");
    }

    const access = requireMonthAccess(c, year, month);
    if ("error" in access) return access.error;

    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;

    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    const ckey = `hist2_m_${guild.guildId}_${year}_${month}_${channelId ?? "None"}_${computeUserIdsKey(userIds)}`;
    const headers = monthCacheControl(access.isRestricted);
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const bounds = monthBounds(year, month);
    if (!Array.isArray(bounds)) return jsonError(400, bounds);
    const [startDate, endDate] = bounds;

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [startDate, endDate];
    const filters = ["created_at >= $1", "created_at < $2", "is_bot = FALSE"];
    params.push(guild.guildId);
    filters.push(`guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "channel_id", scope);
    const where = filters.join(" AND ");

    const { rows: tRows } = await pool.query(
      `SELECT DATE(created_at) as d, count(*) as c, count(DISTINCT user_id) AS u, COALESCE(sum(char_count), 0) AS chars FROM messages WHERE ${where} GROUP BY DATE(created_at)`,
      params,
    );
    const topWhere = where
      .replaceAll("channel_id", "m.channel_id")
      .replaceAll("created_at", "m.created_at")
      .replaceAll("is_bot", "m.is_bot");
    const { rows: topU } = await pool.query(
      `SELECT m.user_id, count(*) as c FROM messages m LEFT JOIN users u ON m.user_id = u.user_id WHERE ${topWhere} AND ${DELETED_USER_FILTER} GROUP BY m.user_id ORDER BY c DESC LIMIT 100`,
      params,
    );

    const targetIds = topU.map((row) => String(row.user_id));
    for (const uid of userIds) {
      if (/^\d+$/.test(uid) && !targetIds.includes(uid)) targetIds.push(uid);
    }

    const dataMap = new Map<string, Record<string, unknown>>();
    for (const row of tRows) {
      const date = String(row.d);
      dataMap.set(date, {
        date,
        total: Number(row.c),
        users: Number(row.u ?? 0),
        chars: Number(row.chars ?? 0),
      });
    }
    const uDetails: Record<string, Record<string, unknown>> = {};
    if (targetIds.length > 0) {
      const detailParams = [...params, targetIds];
      const { rows } = await pool.query(
        `SELECT DATE(created_at) as d, user_id, count(*) as c FROM messages WHERE ${where} AND user_id = ANY($${detailParams.length}::bigint[]) GROUP BY DATE(created_at), user_id`,
        detailParams,
      );
      for (const row of rows) {
        const date = String(row.d);
        if (!dataMap.has(date)) dataMap.set(date, { date, total: 0 });
        dataMap.get(date)![String(row.user_id)] = Number(row.c);
      }
      const { rows: uRows } = await pool.query(
        "SELECT user_id, display_name, username, avatar_url FROM users WHERE user_id = ANY($1::bigint[])",
        [targetIds],
      );
      for (const row of uRows) {
        uDetails[String(row.user_id)] = {
          name: row.display_name,
          username: row.username,
          avatar: row.avatar_url,
        };
      }
    }

    const chartData = [...dataMap.values()].sort((a, b) =>
      String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0,
    );
    const res = {
      chart_data: chartData,
      users: uDetails,
      top_user_id: topU.length > 0 ? String(topU[0].user_id) : null,
    };
    cache.set(ckey, res, 600);
    return jsonResponse(res, 200, headers);
  });

  app.get("/stats/history/total", async (c) => {
    const userIds = c.req.queries("user_id") ?? [];
    if (userIds.length > 5) {
      return jsonError(400, "At most 5 user_id values are allowed");
    }
    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;
    const endRaw = c.req.query("end_date");
    const endDate = parseEndDate(endRaw);
    if (endDate === "invalid") return jsonError(422, "Invalid query parameter: end_date");

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;
    const ckey = `hist2_t_${guild.guildId}_${channelId ?? "None"}_${computeUserIdsKey(userIds)}_${endRaw ?? "None"}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [];
    const filters = ["is_bot = FALSE"];
    params.push(guild.guildId);
    filters.push(`guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "channel_id", scope);
    if (endDate) {
      params.push(endDate);
      filters.push(`created_at <= $${params.length}`);
    }
    const where = filters.join(" AND ");

    const { rows: tRows } = await pool.query(
      `SELECT DATE(created_at) as d, count(*) as c, count(DISTINCT user_id) AS u, COALESCE(sum(char_count), 0) AS chars FROM messages WHERE ${where} GROUP BY DATE(created_at)`,
      params,
    );
    const lineWhere = where
      .replaceAll("channel_id", "m.channel_id")
      .replaceAll("created_at", "m.created_at");
    const { rows: topU } = await pool.query(
      `SELECT m.user_id, count(*) as c FROM messages m LEFT JOIN users u ON m.user_id = u.user_id WHERE ${lineWhere} AND ${DELETED_USER_FILTER} GROUP BY m.user_id ORDER BY c DESC LIMIT 100`,
      params,
    );

    const targetIds = topU.map((row) => String(row.user_id));
    for (const uid of userIds) {
      if (/^\d+$/.test(uid) && !targetIds.includes(uid)) targetIds.push(uid);
    }

    const dataMap = new Map<string, Record<string, unknown>>();
    for (const row of tRows) {
      const date = String(row.d);
      dataMap.set(date, {
        date,
        total: Number(row.c),
        users: Number(row.u ?? 0),
        chars: Number(row.chars ?? 0),
      });
    }
    const uDetails: Record<string, Record<string, unknown>> = {};
    if (targetIds.length > 0) {
      const detailParams = [...params, targetIds];
      const { rows } = await pool.query(
        `SELECT DATE(created_at) as d, user_id, count(*) as c FROM messages WHERE ${where} AND user_id = ANY($${detailParams.length}::bigint[]) GROUP BY DATE(created_at), user_id`,
        detailParams,
      );
      for (const row of rows) {
        const date = String(row.d);
        if (!dataMap.has(date)) dataMap.set(date, { date, total: 0 });
        dataMap.get(date)![String(row.user_id)] = Number(row.c);
      }
      const { rows: uRows } = await pool.query(
        "SELECT user_id, display_name, username, avatar_url FROM users WHERE user_id = ANY($1::bigint[])",
        [targetIds],
      );
      for (const row of uRows) {
        uDetails[String(row.user_id)] = {
          name: row.display_name,
          username: row.username,
          avatar: row.avatar_url,
        };
      }
    }

    const chartData = [...dataMap.values()].sort((a, b) =>
      String(a.date) < String(b.date) ? -1 : String(b.date) < String(a.date) ? 1 : 0,
    );
    const res = {
      chart_data: chartData,
      users: uDetails,
      top_user_id: topU.length > 0 ? String(topU[0].user_id) : null,
    };
    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  });

  app.get("/stats/heatmap/:year/:month", async (c) => {
    const year = pathInt(c.req.param("year"));
    const month = pathInt(c.req.param("month"));
    if (year === null || month === null) return jsonError(422, "Invalid path parameter");

    const access = requireMonthAccess(c, year, month);
    if ("error" in access) return access.error;

    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;

    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    const ckey = `heat_m_${guild.guildId}_${year}_${month}_${channelId ?? "None"}`;
    const headers = monthCacheControl(access.isRestricted);
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const bounds = monthBounds(year, month);
    if (!Array.isArray(bounds)) return jsonError(400, bounds);
    const [startDate, endDate] = bounds;

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [startDate, endDate];
    const filters = ["created_at >= $1", "created_at < $2", "is_bot = FALSE"];
    params.push(guild.guildId);
    filters.push(`guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "channel_id", scope);

    const { rows } = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as hour, count(*) as count FROM messages WHERE ${filters.join(" AND ")} GROUP BY dow, hour`,
      params,
    );
    const res = rows.map((row) => ({
      dow: Number(row.dow),
      hour: Number(row.hour),
      count: Number(row.count),
    }));
    cache.set(ckey, res, 600);
    return jsonResponse(res, 200, headers);
  });

  app.get("/stats/heatmap/total", async (c) => {
    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;
    const endRaw = c.req.query("end_date");
    const endDate = parseEndDate(endRaw);
    if (endDate === "invalid") return jsonError(422, "Invalid query parameter: end_date");

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;
    const ckey = `heat_t_${guild.guildId}_${channelId ?? "None"}_${endRaw ?? "None"}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [];
    const filters = ["is_bot = FALSE"];
    params.push(guild.guildId);
    filters.push(`guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "channel_id", scope);
    if (endDate) {
      params.push(endDate);
      filters.push(`created_at <= $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as hour, count(*) as count FROM messages WHERE ${filters.join(" AND ")} GROUP BY dow, hour`,
      params,
    );
    const res = rows.map((row) => ({
      dow: Number(row.dow),
      hour: Number(row.hour),
      count: Number(row.count),
    }));
    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  });

  app.get("/stats/channels_distribution/:year/:month", async (c) => {
    const year = pathInt(c.req.param("year"));
    const month = pathInt(c.req.param("month"));
    if (year === null || month === null) return jsonError(422, "Invalid path parameter");

    const access = requireMonthAccess(c, year, month);
    if ("error" in access) return access.error;

    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    const ckey = `pie_m_${guild.guildId}_${year}_${month}`;
    const headers = monthCacheControl(access.isRestricted);
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const bounds = monthBounds(year, month);
    if (!Array.isArray(bounds)) return jsonError(400, bounds);
    const [startDate, endDate] = bounds;

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const privateChatCategoryIds = guild.displayConfig.privateChatCategoryIds;
    const { rows } = await pool.query(
      privateChatCategoryIds.length > 0
        ? `
      SELECT
          CASE
              WHEN c.category_id = ANY($3::bigint[]) THEN
                  (CASE WHEN c.name LIKE '% / %' THEN btrim(split_part(c.name, '/', 1)) ELSE c.name END)
              ELSE 'プラチャ'
          END AS name,
          count(*) AS count
      FROM messages m
      JOIN channels c ON m.channel_id = c.channel_id
      WHERE m.created_at >= $1 AND m.created_at < $2 AND m.is_bot = FALSE AND m.guild_id = $4
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
      `
        : `
      SELECT CASE WHEN c.name LIKE '% / %' THEN btrim(split_part(c.name, '/', 1)) ELSE c.name END AS name, count(*) AS count
      FROM messages m
      JOIN channels c ON m.channel_id = c.channel_id
      WHERE m.created_at >= $1 AND m.created_at < $2 AND m.is_bot = FALSE AND m.guild_id = $3
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
      `,
      privateChatCategoryIds.length > 0
        ? [startDate, endDate, privateChatCategoryIds, guild.guildId]
        : [startDate, endDate, guild.guildId],
    );
    const res = rows.map((row) => ({ name: row.name as string, value: Number(row.count) }));
    cache.set(ckey, res, 600);
    return jsonResponse(res, 200, headers);
  });

  app.get("/stats/channels_distribution/total", async (c) => {
    const endRaw = c.req.query("end_date");
    const endDate = parseEndDate(endRaw);
    if (endDate === "invalid") return jsonError(422, "Invalid query parameter: end_date");

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;
    const ckey = `pie_t_${guild.guildId}_${endRaw ?? "None"}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const privateChatCategoryIds = guild.displayConfig.privateChatCategoryIds;
    const params: unknown[] = privateChatCategoryIds.length > 0 ? [privateChatCategoryIds] : [];
    const filters = ["m.is_bot = FALSE"];
    params.push(guild.guildId);
    filters.push(`m.guild_id = $${params.length}`);
    if (endDate) {
      params.push(endDate);
      filters.push(`m.created_at <= $${params.length}`);
    }

    const { rows } = await pool.query(
      privateChatCategoryIds.length > 0
        ? `
      SELECT
          CASE
              WHEN c.category_id = ANY($1::bigint[]) THEN
                  (CASE WHEN c.name LIKE '% / %' THEN btrim(split_part(c.name, '/', 1)) ELSE c.name END)
              ELSE 'プラチャ'
          END AS name,
          count(*) AS count
      FROM messages m
      JOIN channels c ON m.channel_id = c.channel_id
      WHERE ${filters.join(" AND ")}
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
      `
        : `
      SELECT CASE WHEN c.name LIKE '% / %' THEN btrim(split_part(c.name, '/', 1)) ELSE c.name END AS name, count(*) AS count
      FROM messages m
      JOIN channels c ON m.channel_id = c.channel_id
      WHERE ${filters.join(" AND ")}
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
      `,
      params,
    );
    const res = rows.map((row) => ({ name: row.name as string, value: Number(row.count) }));
    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  });

  app.get("/stats/analysis/:year/:month", async (c) => {
    const year = pathInt(c.req.param("year"));
    const month = pathInt(c.req.param("month"));
    if (year === null || month === null) return jsonError(422, "Invalid path parameter");

    const access = requireMonthAccess(c, year, month);
    if ("error" in access) return access.error;

    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;
    const userParam = c.req.query("user_id");
    if (userParam !== undefined && userParam.length > 20) {
      return jsonError(422, "Invalid query parameter: user_id");
    }

    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    const ckey = `ana_m_${guild.guildId}_${year}_${month}_${channelId ?? "None"}_${userParam ?? "None"}`;
    const headers = monthCacheControl(access.isRestricted);
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const bounds = monthBounds(year, month);
    if (!Array.isArray(bounds)) return jsonError(400, bounds);
    const [startDate, endDate] = bounds;

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [startDate, endDate];
    const filters = ["created_at >= $1", "created_at < $2", "is_bot = FALSE"];
    params.push(guild.guildId);
    filters.push(`guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "channel_id", scope);
    if (userParam && /^\d+$/.test(userParam)) {
      params.push(userParam);
      filters.push(`user_id = $${params.length}`);
    }
    const where = filters.join(" AND ");

    const { rows: countRows } = await pool.query(
      `SELECT count(*) as total, COALESCE(sum(char_count), 0) as chars FROM messages WHERE ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);
    if (total === 0) return jsonResponse({ total: 0, char_count: 0 }, 200, headers);
    const charCount = Number(countRows[0]?.chars ?? 0);

    const uniqueWhere = where
      .replaceAll("channel_id", "m.channel_id")
      .replaceAll("created_at", "m.created_at")
      .replaceAll("is_bot", "m.is_bot")
      .replaceAll("user_id", "m.user_id");
    const { rows: uniqueRows } = await pool.query(
      `
      SELECT count(DISTINCT m.user_id) AS unique_users
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.user_id
      WHERE ${uniqueWhere}
        AND ${DELETED_USER_FILTER}
      `,
      params,
    );
    const uniqueUsers = Number(uniqueRows[0]?.unique_users ?? 0);

    const { rows: maxDRows } = await pool.query(
      `SELECT DATE(created_at AT TIME ZONE 'Asia/Tokyo') as d, count(*) as c FROM messages WHERE ${where} GROUP BY d ORDER BY c DESC LIMIT 5`,
      params,
    );
    const { rows: maxWRows } = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, count(*) as c FROM messages WHERE ${where} GROUP BY dow ORDER BY c DESC LIMIT 1`,
      params,
    );
    const { rows: maxHRows } = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as h, count(*) as c FROM messages WHERE ${where} GROUP BY h ORDER BY c DESC LIMIT 1`,
      params,
    );

    const res = {
      total,
      char_count: charCount,
      unique_users: uniqueUsers,
      max_date: maxDRows[0] ? { date: String(maxDRows[0].d), count: Number(maxDRows[0].c) } : null,
      top_dates: maxDRows.map((row) => ({ date: String(row.d), count: Number(row.c) })),
      max_dow: maxWRows[0] ? { dow: Number(maxWRows[0].dow), count: Number(maxWRows[0].c) } : null,
      max_hour: maxHRows[0] ? { hour: Number(maxHRows[0].h), count: Number(maxHRows[0].c) } : null,
    };
    cache.set(ckey, res, 600);
    return jsonResponse(res, 200, headers);
  });

  app.get("/stats/analysis/total", async (c) => {
    const channelParam = c.req.query("channel_id");
    if (channelParam !== undefined && !/^-?\d+$/.test(channelParam)) {
      return jsonError(422, "Invalid query parameter: channel_id");
    }
    const channelId = channelParam ?? null;
    const userParam = c.req.query("user_id");
    if (userParam !== undefined && userParam.length > 20) {
      return jsonError(422, "Invalid query parameter: user_id");
    }
    const endRaw = c.req.query("end_date");
    const endDate = parseEndDate(endRaw);
    if (endDate === "invalid") return jsonError(422, "Invalid query parameter: end_date");

    const ttl = endDate ? 86400 : LIVE_TOTAL_CACHE_TTL;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;
    const ckey = `ana_t_${guild.guildId}_${channelId ?? "None"}_${userParam ?? "None"}_${endRaw ?? "None"}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const scope = await getChannelScopeIds(pool, guild, channelId);
    if (scope instanceof Response) return scope;

    const params: unknown[] = [];
    const filters = ["is_bot = FALSE"];
    params.push(guild.guildId);
    filters.push(`guild_id = $${params.length}`);
    addChannelScopeFilter(params, filters, "channel_id", scope);
    if (userParam && /^\d+$/.test(userParam)) {
      params.push(userParam);
      filters.push(`user_id = $${params.length}`);
    }
    if (endDate) {
      params.push(endDate);
      filters.push(`created_at <= $${params.length}`);
    }
    const where = filters.join(" AND ");

    const { rows: countRows } = await pool.query(
      `SELECT count(*) as total, COALESCE(sum(char_count), 0) as chars FROM messages WHERE ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);
    if (total === 0) return jsonResponse({ total: 0, char_count: 0 }, 200, headers);
    const charCount = Number(countRows[0]?.chars ?? 0);

    const uniqueWhere = where
      .replaceAll("channel_id", "m.channel_id")
      .replaceAll("created_at", "m.created_at")
      .replaceAll("is_bot", "m.is_bot")
      .replaceAll("user_id", "m.user_id");
    const { rows: uniqueRows } = await pool.query(
      `
      SELECT count(DISTINCT m.user_id) AS unique_users
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.user_id
      WHERE ${uniqueWhere}
        AND ${DELETED_USER_FILTER}
      `,
      params,
    );
    const uniqueUsers = Number(uniqueRows[0]?.unique_users ?? 0);

    const { rows: maxDRows } = await pool.query(
      `SELECT DATE(created_at AT TIME ZONE 'Asia/Tokyo') as d, count(*) as c FROM messages WHERE ${where} GROUP BY d ORDER BY c DESC LIMIT 5`,
      params,
    );
    const { rows: maxWRows } = await pool.query(
      `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') as dow, count(*) as c FROM messages WHERE ${where} GROUP BY dow ORDER BY c DESC LIMIT 1`,
      params,
    );
    const { rows: maxHRows } = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as h, count(*) as c FROM messages WHERE ${where} GROUP BY h ORDER BY c DESC LIMIT 1`,
      params,
    );

    const res = {
      total,
      char_count: charCount,
      unique_users: uniqueUsers,
      max_date: maxDRows[0] ? { date: String(maxDRows[0].d), count: Number(maxDRows[0].c) } : null,
      top_dates: maxDRows.map((row) => ({ date: String(row.d), count: Number(row.c) })),
      max_dow: maxWRows[0] ? { dow: Number(maxWRows[0].dow), count: Number(maxWRows[0].c) } : null,
      max_hour: maxHRows[0] ? { hour: Number(maxHRows[0].h), count: Number(maxHRows[0].c) } : null,
    };
    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  });

  /** チャンネル別統計 (前期間比較付き)。表示順は発言数降順 */
  const channelStats = async (c: Context, isAll: boolean) => {
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let prevStart: Date | null = null;
    let prevEnd: Date | null = null;
    let yearParam = "";
    let monthParam = "";
    if (!isAll) {
      yearParam = c.req.param("year") ?? "";
      monthParam = c.req.param("month") ?? "";
      const year = pathInt(yearParam);
      const month = pathInt(monthParam);
      if (year === null || month === null) return jsonError(422, "Invalid path parameter");
      const bounds = monthBounds(year, month);
      if (!Array.isArray(bounds)) return jsonError(400, bounds);
      [startDate, endDate] = bounds;
      const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
      const prevBounds = monthBounds(prev.year, prev.month);
      if (!Array.isArray(prevBounds)) return jsonError(400, prevBounds);
      [prevStart, prevEnd] = prevBounds;
    }

    const ttl = isAll ? 86400 : 600;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const ckey = `ch_stats_${guild.guildId}_${isAll ? "all" : `${yearParam}_${monthParam}`}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");

    const { rows: channelRows } = await pool.query(
      "SELECT channel_id, name, category_name, position FROM channels WHERE guild_id = $1 AND is_active = TRUE",
      [guild.guildId],
    );

    // スレッド ("親板 / スレ名" 形式) を親チャンネルへ集約するマッピング
    const nameToId = new Map<string, string>();
    for (const row of channelRows as Array<Record<string, unknown>>) {
      nameToId.set(String(row.name), String(row.channel_id));
    }
    const parentIdOf = new Map<string, string>();
    for (const row of channelRows as Array<Record<string, unknown>>) {
      const name = String(row.name);
      const sep = name.indexOf(" / ");
      if (sep <= 0) continue;
      const parent = nameToId.get(name.slice(0, sep));
      if (parent && parent !== String(row.channel_id))
        parentIdOf.set(String(row.channel_id), parent);
    }

    const aggregate = async (start: Date | null, end: Date | null) => {
      const params: unknown[] = [guild.guildId];
      let periodFilter = "";
      if (start && end) {
        params.push(start, end);
        periodFilter = "AND m.created_at >= $2 AND m.created_at < $3";
      }
      const mapValues: string[] = [];
      for (const [childId, parentId] of parentIdOf) {
        const cid = params.push(childId);
        const tid = params.push(parentId);
        mapValues.push(`($${cid}::bigint, $${tid}::bigint)`);
      }
      const mappingJoin =
        mapValues.length > 0
          ? `LEFT JOIN (VALUES ${mapValues.join(",")}) AS m2(cid, top) ON m2.cid = m.channel_id`
          : "";
      const groupExpr = mapValues.length > 0 ? "COALESCE(m2.top, m.channel_id)" : "m.channel_id";
      const { rows } = await pool.query(
        `
        SELECT ${groupExpr} AS channel_id, count(*) AS messages, count(DISTINCT m.user_id) AS users, COALESCE(sum(m.char_count), 0) AS chars
        FROM messages m
        ${mappingJoin}
        WHERE m.guild_id = $1 AND m.is_bot = FALSE ${periodFilter}
        GROUP BY 1
        `,
        params,
      );
      const map = new Map<string, { messages: number; users: number; chars: number }>();
      for (const row of rows) {
        map.set(String(row.channel_id), {
          messages: Number(row.messages),
          users: Number(row.users),
          chars: Number(row.chars),
        });
      }
      return map;
    };

    const [currentMap, prevMap] = await Promise.all([
      aggregate(startDate, endDate),
      isAll ? Promise.resolve(new Map()) : aggregate(prevStart, prevEnd),
    ]);

    const res = (channelRows as Array<Record<string, unknown>>)
      .filter((row) => !parentIdOf.has(String(row.channel_id)))
      .map((row) => {
        const id = String(row.channel_id);
        const current = currentMap.get(id) ?? { messages: 0, users: 0, chars: 0 };
        const prev = prevMap.get(id) ?? null;
        return {
          channel_id: id,
          name: row.name as string,
          category: (row.category_name as string) || "未分類",
          position: Number(row.position) || 999999,
          messages: current.messages,
          users: current.users,
          chars: current.chars,
          prev: prev ? { messages: prev.messages, users: prev.users, chars: prev.chars } : null,
        };
      })
      .sort((a, b) => b.messages - a.messages || a.position - b.position);

    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  };

  app.get("/channels/stats/:year/:month", (c) => channelStats(c, false));
  app.get("/channels/stats/total", (c) => channelStats(c, true));

  /** メンバー別統計 (検索・ランキング付き)。全件を返すのでフロントで絵り込み・ページングする */
  const memberStats = async (c: Context, isAll: boolean) => {
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let prevStart: Date | null = null;
    let prevEnd: Date | null = null;
    let yearParam = "";
    let monthParam = "";
    if (!isAll) {
      yearParam = c.req.param("year") ?? "";
      monthParam = c.req.param("month") ?? "";
      const year = pathInt(yearParam);
      const month = pathInt(monthParam);
      if (year === null || month === null) return jsonError(422, "Invalid path parameter");
      const bounds = monthBounds(year, month);
      if (!Array.isArray(bounds)) return jsonError(400, bounds);
      [startDate, endDate] = bounds;
      const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
      const prevBounds = monthBounds(prev.year, prev.month);
      if (!Array.isArray(prevBounds)) return jsonError(400, prevBounds);
      [prevStart, prevEnd] = prevBounds;
    }

    const ttl = isAll ? 86400 : 600;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const ckey = `member_stats_${guild.guildId}_${isAll ? "all" : `${yearParam}_${monthParam}`}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");

    const aggregate = async (start: Date | null, end: Date | null) => {
      const params: unknown[] = [guild.guildId];
      let periodFilter = "";
      if (start && end) {
        params.push(start, end);
        periodFilter = "AND created_at >= $2 AND created_at < $3";
      }
      const { rows } = await pool.query(
        `SELECT user_id, count(*) AS messages, COALESCE(sum(char_count), 0) AS chars
         FROM messages WHERE guild_id = $1 AND is_bot = FALSE ${periodFilter} GROUP BY user_id`,
        params,
      );
      const map = new Map<string, { messages: number; chars: number }>();
      for (const row of rows) {
        map.set(String(row.user_id), { messages: Number(row.messages), chars: Number(row.chars) });
      }
      return map;
    };

    const [currentMap, prevMap, { rows: memberRows }] = await Promise.all([
      aggregate(startDate, endDate),
      isAll ? Promise.resolve(new Map()) : aggregate(prevStart, prevEnd),
      pool.query(
        `
        SELECT gm.user_id, gm.display_name, u.username, u.avatar_url,
               u.banner_url AS user_banner_url, u.avatar_decoration_url, u.nameplate_asset, u.nameplate_palette,
               u.primary_guild_tag, u.primary_guild_badge_url,
               gm.banner_url AS member_banner_url, gm.joined_at, gm.premium_since
        FROM guild_members gm
        JOIN users u ON u.user_id = gm.user_id
        WHERE gm.guild_id = $1
          AND u.username NOT ILIKE 'deleted%user'
          AND gm.display_name NOT ILIKE 'deleted%user'
          AND u.display_name NOT ILIKE 'deleted%user'
        `,
        [guild.guildId],
      ),
    ]);

    const res = (memberRows as Array<Record<string, unknown>>)
      .map((row) => {
        const id = String(row.user_id);
        const current = currentMap.get(id) ?? { messages: 0, chars: 0 };
        const prev = prevMap.get(id) ?? null;
        return {
          user_id: id,
          display_name: (row.display_name as string) || "Unknown",
          username: (row.username as string) || "unknown",
          avatar: (row.avatar_url as string | null) ?? null,
          banner:
            (row.member_banner_url as string | null) ??
            (row.user_banner_url as string | null) ??
            null,
          accent_color: null,
          avatar_decoration: (row.avatar_decoration_url as string | null) ?? null,
          nameplate: (row.nameplate_asset as string | null)
            ? {
                asset: row.nameplate_asset as string,
                palette: (row.nameplate_palette as string | null) ?? "white",
              }
            : null,
          primary_guild_tag: (row.primary_guild_tag as string | null) ?? null,
          primary_guild_badge: (row.primary_guild_badge_url as string | null) ?? null,
          joined_at: row.joined_at ? new Date(row.joined_at as string).toISOString() : null,
          premium_since: row.premium_since
            ? new Date(row.premium_since as string).toISOString()
            : null,
          messages: current.messages,
          chars: current.chars,
          prev: prev ? { messages: prev.messages, chars: prev.chars } : null,
        };
      })
      .sort((a, b) => b.messages - a.messages || a.user_id.localeCompare(b.user_id))
      .map((entry, index) => ({ ...entry, rank: entry.messages > 0 ? index + 1 : null }));

    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  };

  app.get("/users/members/:year/:month", (c) => memberStats(c, false));
  app.get("/users/members/total", (c) => memberStats(c, true));

  /** 個人インサイト (メンバー詳細ページ用) */
  const userInsights = async (c: Context, isAll: boolean) => {
    const userId = c.req.param("userId") ?? "";
    if (!/^\d+$/.test(userId)) return jsonError(422, "Invalid path parameter: user_id");

    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let yearParam = "";
    let monthParam = "";
    if (!isAll) {
      yearParam = c.req.param("year") ?? "";
      monthParam = c.req.param("month") ?? "";
      const year = pathInt(yearParam);
      const month = pathInt(monthParam);
      if (year === null || month === null) return jsonError(422, "Invalid path parameter");
      const bounds = monthBounds(year, month);
      if (!Array.isArray(bounds)) return jsonError(400, bounds);
      [startDate, endDate] = bounds;
    }

    const ttl = isAll ? 86400 : 600;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const ckey = `user_ins_${guild.guildId}_${userId}_${isAll ? "all" : `${yearParam}_${monthParam}`}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");

    const baseParams: unknown[] = [guild.guildId, userId];
    let periodFilter = "";
    if (startDate && endDate) {
      baseParams.push(startDate, endDate);
      periodFilter = "AND created_at >= $3 AND created_at < $4";
    }

    const [summaryRes, profileRes] = await Promise.all([
      pool.query(
        `SELECT count(*) AS messages, COALESCE(sum(char_count), 0) AS chars,
                MIN(created_at) AS first_at, MAX(created_at) AS last_at
         FROM messages WHERE guild_id = $1 AND user_id = $2 AND is_bot = FALSE ${periodFilter}`,
        baseParams,
      ),
      pool.query(
        `SELECT gm.display_name, u.username, u.avatar_url,
                COALESCE(gm.banner_url, u.banner_url) AS banner_url, u.accent_color,
                u.avatar_decoration_url, u.nameplate_asset, u.nameplate_palette,
                u.primary_guild_tag, u.primary_guild_badge_url, gm.joined_at, gm.premium_since
         FROM guild_members gm JOIN users u ON u.user_id = gm.user_id
         WHERE gm.guild_id = $1 AND gm.user_id = $2`,
        [guild.guildId, userId],
      ),
    ]);

    const messages = Number(summaryRes.rows[0]?.messages ?? 0);
    if (messages === 0) {
      const payload = {
        user: null,
        messages: 0,
        chars: 0,
        rank: null,
        daily: [],
        channels: [],
        dow: [],
        hours: [],
        first_at: null,
        last_at: null,
      };
      cache.set(ckey, payload, ttl);
      return jsonResponse(payload, 200, headers);
    }

    // 閾値 (本人の発言数) はパラメータ末尾に追加する。参照しないパラメータがあると
    // Postgresが型を推定できずエラーになるため、ランククエリ専用のパラメータ配列を組む
    const rankParams: unknown[] = [guild.guildId];
    let rankPeriodFilter = "";
    if (startDate && endDate) {
      rankParams.push(startDate, endDate);
      rankPeriodFilter = "AND created_at >= $2 AND created_at < $3";
    }
    rankParams.push(messages);
    const rankThreshold = `$${rankParams.length}`;
    const { rows: rankRows } = await pool.query(
      `
      SELECT (
        SELECT count(*) + 1
        FROM (
          SELECT user_id FROM messages
          WHERE guild_id = $1 AND is_bot = FALSE ${rankPeriodFilter}
          GROUP BY user_id HAVING count(*) > ${rankThreshold}
        ) higher
      ) AS rank
      `,
      rankParams,
    );

    const [dailyRes, channelsRes, dowRes, hoursRes] = await Promise.all([
      pool.query(
        `SELECT DATE(created_at AT TIME ZONE 'Asia/Tokyo') AS d, count(*) AS c, COALESCE(sum(char_count), 0) AS chars
         FROM messages WHERE guild_id = $1 AND user_id = $2 AND is_bot = FALSE ${periodFilter}
         GROUP BY d ORDER BY d`,
        baseParams,
      ),
      pool.query(
        `SELECT m.channel_id, c.name, count(*) AS c
         FROM messages m JOIN channels c ON c.channel_id = m.channel_id AND c.guild_id = m.guild_id
         WHERE m.guild_id = $1 AND m.user_id = $2 AND m.is_bot = FALSE ${periodFilter}
         GROUP BY m.channel_id, c.name ORDER BY c DESC LIMIT 10`,
        baseParams,
      ),
      pool.query(
        `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') AS dow, count(*) AS c
         FROM messages WHERE guild_id = $1 AND user_id = $2 AND is_bot = FALSE ${periodFilter} GROUP BY dow`,
        baseParams,
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') AS hour, count(*) AS c
         FROM messages WHERE guild_id = $1 AND user_id = $2 AND is_bot = FALSE ${periodFilter} GROUP BY hour`,
        baseParams,
      ),
    ]);

    const profile = profileRes.rows[0];
    const res = {
      user: profile
        ? {
            user_id: userId,
            display_name: (profile.display_name as string) || "Unknown",
            username: (profile.username as string) || "unknown",
            avatar: (profile.avatar_url as string | null) ?? null,
            banner: (profile.banner_url as string | null) ?? null,
            accent_color: (profile.accent_color as string | null) ?? null,
            avatar_decoration: (profile.avatar_decoration_url as string | null) ?? null,
            nameplate: (profile.nameplate_asset as string | null)
              ? {
                  asset: profile.nameplate_asset as string,
                  palette: (profile.nameplate_palette as string | null) ?? "white",
                }
              : null,
            primary_guild_tag: (profile.primary_guild_tag as string | null) ?? null,
            primary_guild_badge: (profile.primary_guild_badge_url as string | null) ?? null,
            joined_at: profile.joined_at
              ? new Date(profile.joined_at as string).toISOString()
              : null,
            premium_since: profile.premium_since
              ? new Date(profile.premium_since as string).toISOString()
              : null,
          }
        : null,
      messages,
      chars: Number(summaryRes.rows[0]?.chars ?? 0),
      rank: rankRows[0]?.rank !== undefined ? Number(rankRows[0].rank) : null,
      daily: dailyRes.rows.map((row) => ({
        date: String(row.d),
        count: Number(row.c),
        chars: Number(row.chars),
      })),
      channels: channelsRes.rows.map((row) => ({
        channel_id: String(row.channel_id),
        name: row.name as string,
        count: Number(row.c),
      })),
      dow: dowRes.rows.map((row) => ({ dow: Number(row.dow), count: Number(row.c) })),
      hours: hoursRes.rows.map((row) => ({ hour: Number(row.hour), count: Number(row.c) })),
      first_at: summaryRes.rows[0]?.first_at
        ? new Date(summaryRes.rows[0].first_at as string).toISOString()
        : null,
      last_at: summaryRes.rows[0]?.last_at
        ? new Date(summaryRes.rows[0].last_at as string).toISOString()
        : null,
    };
    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  };

  app.get("/users/:userId/insights/:year/:month", (c) => userInsights(c, false));
  app.get("/users/:userId/insights/total", (c) => userInsights(c, true));

  /** チャンネルインサイト (チャンネル詳細ページ用) */
  const channelInsights = async (c: Context, isAll: boolean) => {
    const channelId = c.req.param("channelId") ?? "";
    if (!/^\d+$/.test(channelId)) return jsonError(422, "Invalid path parameter: channel_id");

    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let yearParam = "";
    let monthParam = "";
    if (!isAll) {
      yearParam = c.req.param("year") ?? "";
      monthParam = c.req.param("month") ?? "";
      const year = pathInt(yearParam);
      const month = pathInt(monthParam);
      if (year === null || month === null) return jsonError(422, "Invalid path parameter");
      const bounds = monthBounds(year, month);
      if (!Array.isArray(bounds)) return jsonError(400, bounds);
      [startDate, endDate] = bounds;
    }

    const ttl = isAll ? 86400 : 600;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const ckey = `ch_ins_${guild.guildId}_${channelId}_${isAll ? "all" : `${yearParam}_${monthParam}`}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");

    const emptyPayload = {
      channel: null,
      messages: 0,
      chars: 0,
      users: 0,
      rank: null,
      daily: [] as Array<{ date: string; count: number }>,
      members: [] as Array<{
        user_id: string;
        display_name: string;
        username: string;
        avatar: string | null;
        avatar_decoration: string | null;
        count: number;
      }>,
      dow: [] as Array<{ dow: number; count: number }>,
      hours: [] as Array<{ hour: number; count: number }>,
      heatmap: [] as Array<{ dow: number; hour: number; count: number }>,
      top_dates: [] as Array<{ date: string; count: number }>,
      first_at: null,
      last_at: null,
    };

    // チャンネル情報と、スレッド ("親板 / スレ名" 形式) を親チャンネルへ集約するマッピング
    const { rows: channelRows } = await pool.query(
      "SELECT channel_id, name, category_name, position FROM channels WHERE guild_id = $1 AND is_active = TRUE",
      [guild.guildId],
    );
    const rows = channelRows as Array<Record<string, unknown>>;
    const self = rows.find((row) => String(row.channel_id) === channelId);
    if (!self) {
      cache.set(ckey, emptyPayload, ttl);
      return jsonResponse(emptyPayload, 200, headers);
    }

    const nameToId = new Map<string, string>();
    for (const row of rows) nameToId.set(String(row.name), String(row.channel_id));
    const parentIdOf = new Map<string, string>();
    for (const row of rows) {
      const name = String(row.name);
      const sep = name.indexOf(" / ");
      if (sep <= 0) continue;
      const parent = nameToId.get(name.slice(0, sep));
      if (parent && parent !== String(row.channel_id))
        parentIdOf.set(String(row.channel_id), parent);
    }
    const targetIds = [
      channelId,
      ...[...parentIdOf.entries()]
        .filter(([, parent]) => parent === channelId)
        .map(([child]) => child),
    ];

    const baseParams: unknown[] = [guild.guildId, targetIds];
    let periodFilter = "";
    if (startDate && endDate) {
      baseParams.push(startDate, endDate);
      periodFilter = "AND created_at >= $3 AND created_at < $4";
    }

    const [summaryRes, dailyRes, dowRes, hoursRes, heatRes, membersRes] = await Promise.all([
      pool.query(
        `SELECT count(*) AS messages, COALESCE(sum(char_count), 0) AS chars,
                count(DISTINCT user_id) AS users,
                MIN(created_at) AS first_at, MAX(created_at) AS last_at
         FROM messages WHERE guild_id = $1 AND channel_id = ANY($2::bigint[]) AND is_bot = FALSE ${periodFilter}`,
        baseParams,
      ),
      pool.query(
        `SELECT DATE(created_at AT TIME ZONE 'Asia/Tokyo') AS d, count(*) AS c
         FROM messages WHERE guild_id = $1 AND channel_id = ANY($2::bigint[]) AND is_bot = FALSE ${periodFilter}
         GROUP BY d ORDER BY d`,
        baseParams,
      ),
      pool.query(
        `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') AS dow, count(*) AS c
         FROM messages WHERE guild_id = $1 AND channel_id = ANY($2::bigint[]) AND is_bot = FALSE ${periodFilter} GROUP BY dow`,
        baseParams,
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') AS hour, count(*) AS c
         FROM messages WHERE guild_id = $1 AND channel_id = ANY($2::bigint[]) AND is_bot = FALSE ${periodFilter} GROUP BY hour`,
        baseParams,
      ),
      pool.query(
        `SELECT EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Tokyo') AS dow,
                EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') AS hour, count(*) AS c
         FROM messages WHERE guild_id = $1 AND channel_id = ANY($2::bigint[]) AND is_bot = FALSE ${periodFilter}
         GROUP BY dow, hour`,
        baseParams,
      ),
      pool.query(
        `SELECT m.user_id, COALESCE(gm.display_name, u.display_name, u.username) AS display_name,
                u.username, u.avatar_url, u.avatar_decoration_url, count(*) AS c
         FROM messages m
         JOIN guild_members gm ON gm.guild_id = m.guild_id AND gm.user_id = m.user_id
         JOIN users u ON u.user_id = m.user_id
         WHERE m.guild_id = $1 AND m.channel_id = ANY($2::bigint[]) AND m.is_bot = FALSE ${periodFilter}
           AND u.username NOT ILIKE 'deleted%user'
           AND gm.display_name NOT ILIKE 'deleted%user'
           AND u.display_name NOT ILIKE 'deleted%user'
         GROUP BY m.user_id, gm.display_name, u.display_name, u.username, u.avatar_url, u.avatar_decoration_url
         ORDER BY c DESC LIMIT 10`,
        baseParams,
      ),
    ]);

    const messages = Number(summaryRes.rows[0]?.messages ?? 0);
    const channelInfo = {
      channel_id: channelId,
      name: self.name as string,
      category: (self.category_name as string) || "未分類",
      position: Number(self.position) || 999999,
    };
    if (messages === 0) {
      const payload = { ...emptyPayload, channel: channelInfo };
      cache.set(ckey, payload, ttl);
      return jsonResponse(payload, 200, headers);
    }

    // チャンネルランク: 同期間の全チャンネル (スレッドは親に集約) 中の発言数順位
    let rank: number | null = null;
    try {
      const mapValues: string[] = [];
      const rankParams: unknown[] = [guild.guildId];
      let rankPeriodFilter = "";
      if (startDate && endDate) {
        rankParams.push(startDate, endDate);
        rankPeriodFilter = "AND m.created_at >= $2 AND m.created_at < $3";
      }
      for (const [childId, parentId] of parentIdOf) {
        const cid = rankParams.push(childId);
        const tid = rankParams.push(parentId);
        mapValues.push(`($${cid}::bigint, $${tid}::bigint)`);
      }
      const mappingJoin =
        mapValues.length > 0
          ? `LEFT JOIN (VALUES ${mapValues.join(",")}) AS m2(cid, top) ON m2.cid = m.channel_id`
          : "";
      const groupExpr = mapValues.length > 0 ? "COALESCE(m2.top, m.channel_id)" : "m.channel_id";
      const { rows: rankRows } = await pool.query(
        `SELECT ${groupExpr} AS cid, count(*) AS c
         FROM messages m ${mappingJoin}
         WHERE m.guild_id = $1 AND m.is_bot = FALSE ${rankPeriodFilter}
         GROUP BY 1`,
        rankParams,
      );
      const countById = new Map<string, number>();
      for (const row of rankRows as Array<Record<string, unknown>>) {
        countById.set(String(row.cid), Number(row.c));
      }
      const own = targetIds.reduce((sum, id) => sum + (countById.get(id) ?? 0), 0);
      if (own > 0) {
        rank = [...countById.values()].filter((value) => value > own).length + 1;
      }
    } catch {
      rank = null;
    }

    const res = {
      channel: channelInfo,
      messages,
      chars: Number(summaryRes.rows[0]?.chars ?? 0),
      users: Number(summaryRes.rows[0]?.users ?? 0),
      rank,
      daily: dailyRes.rows.map((row) => ({ date: String(row.d), count: Number(row.c) })),
      members: membersRes.rows.map((row) => ({
        user_id: String(row.user_id),
        display_name: (row.display_name as string) || "Unknown",
        username: (row.username as string) || "unknown",
        avatar: (row.avatar_url as string | null) ?? null,
        avatar_decoration: (row.avatar_decoration_url as string | null) ?? null,
        count: Number(row.c),
      })),
      dow: dowRes.rows.map((row) => ({ dow: Number(row.dow), count: Number(row.c) })),
      hours: hoursRes.rows.map((row) => ({ hour: Number(row.hour), count: Number(row.c) })),
      heatmap: heatRes.rows.map((row) => ({
        dow: Number(row.dow),
        hour: Number(row.hour),
        count: Number(row.c),
      })),
      top_dates: [...dailyRes.rows]
        .map((row) => ({ date: String(row.d), count: Number(row.c) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      first_at: summaryRes.rows[0]?.first_at
        ? new Date(summaryRes.rows[0].first_at as string).toISOString()
        : null,
      last_at: summaryRes.rows[0]?.last_at
        ? new Date(summaryRes.rows[0].last_at as string).toISOString()
        : null,
    };
    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  };

  app.get("/channels/:channelId/insights/:year/:month", (c) => channelInsights(c, false));
  app.get("/channels/:channelId/insights/total", (c) => channelInsights(c, true));

  /**
   * 関係性グラフ: 同じチャンネルでの発言量 (共活性) を元にしたメンバー間の結び付き。
   * エッジの重みは Σ(チャンネルごとの発言数の小さい方) で、両方がそのチャンネルで
   * 話しているほど強く結ばれることを表す。
   */
  const graphRelation = async (c: Context, isAll: boolean) => {
    const guildOrError = await requireGuild(c);
    if (guildOrError instanceof Response) return guildOrError;
    const guild = guildOrError;

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let yearParam = "";
    let monthParam = "";
    if (!isAll) {
      yearParam = c.req.param("year") ?? "";
      monthParam = c.req.param("month") ?? "";
      const year = pathInt(yearParam);
      const month = pathInt(monthParam);
      if (year === null || month === null) return jsonError(422, "Invalid path parameter");
      const bounds = monthBounds(year, month);
      if (!Array.isArray(bounds)) return jsonError(400, bounds);
      [startDate, endDate] = bounds;
    }

    const ttl = isAll ? 86400 : 600;
    const headers = { "Cache-Control": `public, max-age=${ttl}` };
    const ckey = `graph_rel_${guild.guildId}_${isAll ? "all" : `${yearParam}_${monthParam}`}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");

    const MAX_NODES = 48;
    const baseParams: unknown[] = [guild.guildId];
    let periodFilter = "";
    if (startDate && endDate) {
      baseParams.push(startDate, endDate);
      periodFilter = "AND m.created_at >= $2 AND m.created_at < $3";
    }

    // スレッド ("親 / スレ名") は親チャンネルへ集約する
    const { rows: channelRows } = await pool.query(
      "SELECT channel_id, name FROM channels WHERE guild_id = $1 AND is_active = TRUE",
      [guild.guildId],
    );
    const channelRowsTyped = channelRows as Array<Record<string, unknown>>;
    const nameToId = new Map<string, string>();
    for (const row of channelRowsTyped) nameToId.set(String(row.name), String(row.channel_id));
    const idToName = new Map<string, string>();
    for (const row of channelRowsTyped) idToName.set(String(row.channel_id), String(row.name));
    const parentOf = new Map<string, string>();
    for (const row of channelRowsTyped) {
      const name = String(row.name);
      const sep = name.indexOf(" / ");
      if (sep <= 0) continue;
      const parent = nameToId.get(name.slice(0, sep));
      if (parent && parent !== String(row.channel_id)) parentOf.set(String(row.channel_id), parent);
    }
    const normChannel = (id: string): string => {
      let current = id;
      for (let i = 0; i < 10 && parentOf.has(current); i += 1) current = parentOf.get(current) as string;
      return current;
    };

    const { rows: activityRows } = await pool.query(
      `SELECT m.user_id, COALESCE(gm.display_name, u.display_name, u.username) AS display_name,
              u.username, u.avatar_url, u.avatar_decoration_url, m.channel_id, count(*) AS c
       FROM messages m
       JOIN guild_members gm ON gm.guild_id = m.guild_id AND gm.user_id = m.user_id
       JOIN users u ON u.user_id = m.user_id
       WHERE m.guild_id = $1 AND m.is_bot = FALSE ${periodFilter}
         AND ${DELETED_USER_FILTER}
         AND gm.display_name NOT ILIKE 'deleted%user'
       GROUP BY m.user_id, gm.display_name, u.display_name, u.username, u.avatar_url, u.avatar_decoration_url, m.channel_id
       HAVING count(*) >= 2`,
      baseParams,
    );

    interface RelNode {
      userId: string;
      displayName: string;
      username: string;
      avatar: string | null;
      avatarDecoration: string | null;
      count: number;
      channels: Map<string, number>;
    }
    const byUser = new Map<string, RelNode>();
    for (const raw of activityRows as Array<Record<string, unknown>>) {
      const userId = String(raw.user_id);
      const count = Number(raw.c);
      let node = byUser.get(userId);
      if (!node) {
        node = {
          userId,
          displayName: (raw.display_name as string) || "Unknown",
          username: (raw.username as string) || "unknown",
          avatar: (raw.avatar_url as string | null) ?? null,
          avatarDecoration: (raw.avatar_decoration_url as string | null) ?? null,
          count: 0,
          channels: new Map(),
        };
        byUser.set(userId, node);
      }
      node.count += count;
      const cid = normChannel(String(raw.channel_id));
      node.channels.set(cid, (node.channels.get(cid) ?? 0) + count);
    }

    const nodes = [...byUser.values()].sort((a, b) => b.count - a.count).slice(0, MAX_NODES);
    const nodeIds = new Set(nodes.map((node) => node.userId));

    const edges: Array<{ a: string; b: string; weight: number }> = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const [smaller, larger] = a.channels.size <= b.channels.size ? [a, b] : [b, a];
        let weight = 0;
        for (const [cid, ca] of smaller.channels) {
          const cb = larger.channels.get(cid);
          if (cb) weight += Math.min(ca, cb);
        }
        if (weight >= 2) edges.push({ a: a.userId, b: b.userId, weight });
      }
    }
    edges.sort((x, y) => y.weight - x.weight);
    const limitedEdges = edges.slice(0, 320);

    const payload = {
      nodes: nodes.map((node) => {
        let topChannelId: string | null = null;
        let topCount = 0;
        for (const [cid, count] of node.channels) {
          if (count > topCount) {
            topCount = count;
            topChannelId = cid;
          }
        }
        return {
          user_id: node.userId,
          display_name: node.displayName,
          username: node.username,
          avatar: node.avatar,
          avatar_decoration: node.avatarDecoration,
          count: node.count,
          top_channel: topChannelId ? (idToName.get(topChannelId) ?? null) : null,
        };
      }),
      edges: limitedEdges,
    };
    cache.set(ckey, payload, ttl);
    return jsonResponse(payload, 200, headers);
  };

  app.get("/graph/relation/:year/:month", (c) => graphRelation(c, false));
  app.get("/graph/relation/total", (c) => graphRelation(c, true));

  /**
   * Caddy on-demand TLSのaskエンドポイント。
   * 登録済みかつ有効なギルドドメインのみ証明書発行を許可する (200=許可/404=拒否)。
   * ネットワーク的にVPSのCaddyからのみ到達可能であることを前提とする。
   */
  app.get("/internal/caddy-ask", async (c) => {
    // Caddyからの直接リクエスト (XFFが全て信頼ホップ) のみ許可する。
    // 一般公開されているとドメイン列挙 (200/404) が可能になるため。
    const env = c.env as { peerIp?: string; trustedPeer?: boolean } | undefined;
    if (!env?.trustedPeer || env.peerIp !== "unknown") {
      return plainTextResponse("Not Found", { "Cache-Control": "no-store" }, 404);
    }
    const rawDomain = c.req.query("domain") ?? "";
    const domain = normalizeHost(rawDomain);
    if (!domain || domain.length > 253 || !/^[a-z0-9.-]+$/.test(domain)) {
      return plainTextResponse("Not Found", { "Cache-Control": "no-store" }, 404);
    }
    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");
    const { rows } = await pool.query(
      "SELECT 1 FROM guild_domains WHERE domain = $1 AND is_active LIMIT 1",
      [domain],
    );
    if (rows.length === 0) {
      console.warn(`caddy-ask: 許可されていないドメインへの発行要求 domain=${domain}`);
      return plainTextResponse("Not Found", { "Cache-Control": "no-store" }, 404);
    }
    return plainTextResponse("OK", { "Cache-Control": "no-store" });
  });

  return app;
}

function parseEndDate(raw: string | undefined): Date | null | "invalid" {
  if (!raw) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  let normalized = raw;
  if (dateOnly.test(normalized)) {
    normalized = `${normalized}T00:00:00Z`;
  } else if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(normalized)
  ) {
    return "invalid";
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "invalid";
  return parsed;
}

export function startWarmLoop(app: Hono<AppEnv>): () => void {
  const targets = [
    { name: "ranking_total", path: "/ranking/total" },
    { name: "history_total", path: "/stats/history/total" },
    { name: "heatmap_total", path: "/stats/heatmap/total" },
    { name: "channels_total", path: "/stats/channels_distribution/total" },
    { name: "analysis_total", path: "/stats/analysis/total" },
  ];

  let interval: NodeJS.Timeout | null = null;
  let stopped = false;

  const warmOnce = async (): Promise<void> => {
    for (const target of targets) {
      const started = performance.now();
      try {
        const response = await app.request(target.path);
        const elapsedMs = Math.round(performance.now() - started);
        if (response.ok) {
          console.log(
            `${new Date().toISOString()} [INFO] ymkw-api: Warmed cache: ${target.name} (${elapsedMs}ms)`,
          );
        } else {
          console.warn(
            `${new Date().toISOString()} [WARN] ymkw-api: Failed to warm cache: ${target.name} status=${response.status}`,
          );
        }
      } catch (error) {
        console.warn(
          `${new Date().toISOString()} [WARN] ymkw-api: Failed to warm cache: ${target.name}`,
          error,
        );
      }
    }
  };

  const schedule = setTimeout(() => {
    if (stopped) return;
    void warmOnce();
    interval = setInterval(() => {
      if (!stopped) void warmOnce();
    }, TOTAL_CACHE_WARM_INTERVAL_MS);
  }, 10_000);

  return () => {
    stopped = true;
    clearTimeout(schedule);
    if (interval) clearInterval(interval);
  };
}
