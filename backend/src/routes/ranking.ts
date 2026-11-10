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
import {
  buildAllTimeRankingComponent,
  buildRankingComponent,
  monthlyRankingTitle,
  rankingComponentNotes,
  serializeComponentEmbed,
  type RankingRow,
} from "../../../shared/discord-ranking";
import { monthlyRankingQuery } from "../../../shared/monthly-ranking";
import { totalRankingQuery } from "../../../shared/total-ranking";
/** ランキング (/ranking/*, /users/:id/rank/*) */
export function register(app: Hono<AppEnv>, h: RouteHelpers): void {
  const { cfg, cache, deps, getPeerIp, requireGuild, getChannelScopeIds, requireMonthAccess, monthCacheControl } = h;

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

}
