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

/** ユーザー (/users/search, /users/members, /users/:userId/insights) */
export function register(app: Hono<AppEnv>, h: RouteHelpers): void {
  const { cfg, cache, deps, getPeerIp, requireGuild, getChannelScopeIds, requireMonthAccess, monthCacheControl } = h;

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
              u.avatar_url AS main_avatar_url, u.avatar_decoration_url,
              u.nameplate_asset, u.nameplate_palette,
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
        // ギルド用アイコンが読めなくなった (退出等) 場合の代替として
        // ユーザーIDと紐付いたメインのアバターを併せて返す
        avatar_fallback: row.main_avatar_url ?? null,
        avatar_decoration: row.avatar_decoration_url ?? null,
        nameplate: row.nameplate_asset
          ? { asset: row.nameplate_asset, palette: row.nameplate_palette ?? "white" }
          : null,
        primary_guild_tag: row.primary_guild_tag ?? null,
        primary_guild_badge: row.primary_guild_badge_url ?? null,
      })),
    );
  });

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
        SELECT gm.user_id, gm.display_name, u.username,
               COALESCE(gm.avatar_url, u.avatar_url) AS avatar_url,
               u.avatar_url AS main_avatar_url,
               u.banner_url AS user_banner_url, u.avatar_decoration_url,
               u.nameplate_asset, u.nameplate_palette,
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
          avatar_fallback: (row.main_avatar_url as string | null) ?? null,
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
        `SELECT gm.display_name, u.username,
                COALESCE(gm.avatar_url, u.avatar_url) AS avatar_url, u.avatar_url AS main_avatar_url,
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
            avatar_fallback: (profile.main_avatar_url as string | null) ?? null,
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
}
