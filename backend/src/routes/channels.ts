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

/** チャンネル (/channels, /channels/stats, /channels/:channelId/insights) */
export function register(app: Hono<AppEnv>, h: RouteHelpers): void {
  const { cfg, cache, deps, getPeerIp, requireGuild, getChannelScopeIds, requireMonthAccess, monthCacheControl } = h;

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
        /** 文字数王カード用 (メンバーごとの合計文字数) */
        chars: number;
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
                u.username, u.avatar_url, u.avatar_decoration_url, count(*) AS c,
                COALESCE(sum(m.char_count), 0) AS chars
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
        chars: Number(row.chars ?? 0),
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
}
