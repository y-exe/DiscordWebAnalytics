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

/** 関係グラフ (/graph/*) */
export function register(app: Hono<AppEnv>, h: RouteHelpers): void {
  const { cfg, cache, deps, getPeerIp, requireGuild, getChannelScopeIds, requireMonthAccess, monthCacheControl } = h;

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
    const headers = { "Cache-Control": "no-store" };
    const ckey = `graph_rel_v12_${guild.guildId}_${isAll ? "all" : `${yearParam}_${monthParam}`}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");

    const MAX_NODES = 500;
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
      for (let i = 0; i < 10 && parentOf.has(current); i += 1)
        current = parentOf.get(current) as string;
      return current;
    };

    const { rows: activityRows } = await pool.query(
      `SELECT m.user_id, COALESCE(gm.display_name, u.display_name, u.username) AS display_name,
              u.username, COALESCE(gm.avatar_url, u.avatar_url) AS avatar_url,
              u.avatar_url AS main_avatar_url, u.avatar_decoration_url, m.channel_id, count(*) AS c
       FROM messages m
       JOIN guild_members gm ON gm.guild_id = m.guild_id AND gm.user_id = m.user_id
       JOIN users u ON u.user_id = m.user_id
       WHERE m.guild_id = $1 AND m.is_bot = FALSE ${periodFilter}
         AND ${DELETED_USER_FILTER}
         AND gm.display_name NOT ILIKE 'deleted%user'
       GROUP BY m.user_id, gm.display_name, u.display_name, u.username, gm.avatar_url, u.avatar_url, u.avatar_decoration_url, m.channel_id
       HAVING count(*) >= 1`,
      baseParams,
    );

    interface RelNode {
      userId: string;
      displayName: string;
      username: string;
      avatar: string | null;
      avatarFallback: string | null;
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
          avatarFallback: (raw.main_avatar_url as string | null) ?? null,
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

    const sortedByCount = [...byUser.values()].sort((a, b) => b.count - a.count);
    let nodes = sortedByCount.slice(0, MAX_NODES);
    // 同率の切り捨て: 500位の発言数が501位と同率なら、その発言数のメンバーは全員除外する
    // (同率の一部だけが表示されることがないようにする)
    const countAtBoundary = nodes[nodes.length - 1]?.count ?? 0;
    const countAfterBoundary = sortedByCount[MAX_NODES]?.count ?? -1;
    if (countAtBoundary > 0 && countAtBoundary === countAfterBoundary) {
      nodes = nodes.filter((node) => node.count !== countAtBoundary);
    }
    const nodeIds = new Set(nodes.map((node) => node.userId));

    // 関係値 = 「同じ時間帯に同じチャンネルで発言した回数」(15分窓の共在回数)。
    // メッセージの件数ではなく窓の数で数えるため、発言量そのものには依存しない。
    const { rows: windowRows } = await pool.query(
      `WITH slots AS (
         SELECT DISTINCT m.channel_id,
                FLOOR(EXTRACT(EPOCH FROM m.created_at) / 900)::bigint AS bucket,
                m.user_id
         FROM messages m
         WHERE m.guild_id = $1 AND m.is_bot = FALSE ${periodFilter}
       )
       SELECT s1.user_id AS ua, s2.user_id AS ub, count(*) AS c
       FROM slots s1
       JOIN slots s2 ON s2.channel_id = s1.channel_id AND s2.bucket = s1.bucket AND s2.user_id < s1.user_id
       GROUP BY 1, 2
       HAVING count(*) >= 2`,
      baseParams,
    );

    // チャンネルの一致度 (活動の何割を共通チャンネルに費やしているか 0..1)
    const overlapFraction = (a: RelNode, b: RelNode): number => {
      if (!a.count || !b.count) return 0;
      const [smaller, larger] = a.channels.size <= b.channels.size ? [a, b] : [b, a];
      let shared = 0;
      for (const [cid, ca] of smaller.channels) {
        const cb = larger.channels.get(cid);
        if (cb) shared += Math.min(ca / a.count, cb / b.count);
      }
      return shared;
    };

    const edges: Array<{ a: string; b: string; weight: number }> = [];
    for (const raw of windowRows as Array<Record<string, unknown>>) {
      const a = byUser.get(String(raw.ua));
      const b = byUser.get(String(raw.ub));
      if (!a || !b) continue;
      if (!nodeIds.has(a.userId) || !nodeIds.has(b.userId)) continue;
      const weight = Math.round(Number(raw.c) * (0.7 + 0.3 * overlapFraction(a, b)));
      if (weight >= 2) edges.push({ a: a.userId, b: b.userId, weight });
    }
    edges.sort((x, y) => y.weight - x.weight);

    // 線の本数は発言数に比例させる (logスケール: 1件なら1本、上位者は最大10本)。
    // 各メンバーの次数が予算を超えたら、そのメンバーにとって弱い線から順に削る。
    const countByNode = new Map(nodes.map((node) => [node.userId, node.count]));
    const edgeBudgetOf = (userId: string): number => {
      const count = countByNode.get(userId) ?? 0;
      return Math.max(1, Math.min(10, Math.ceil(Math.log2(count + 1))));
    };
    const keyOf = (edge: { a: string; b: string }): string =>
      edge.a < edge.b ? edge.a + "|" + edge.b : edge.b + "|" + edge.a;
    const incident = new Map<string, Array<{ key: string; weight: number }>>();
    for (const edge of edges) {
      const key = keyOf(edge);
      let la = incident.get(edge.a);
      if (!la) {
        la = [];
        incident.set(edge.a, la);
      }
      la.push({ key, weight: edge.weight });
      let lb = incident.get(edge.b);
      if (!lb) {
        lb = [];
        incident.set(edge.b, lb);
      }
      lb.push({ key, weight: edge.weight });
    }
    // 次数が予算を超えるメンバーから弱い線を外す (他端の次数が減って波及するため反復)
    const removedKeys = new Set<string>();
    let changed = true;
    let pass = 0;
    while (changed && pass < 40) {
      changed = false;
      pass += 1;
      for (const [userId, list] of incident) {
        const budget = edgeBudgetOf(userId);
        const alive = list.filter((entry) => !removedKeys.has(entry.key));
        if (alive.length <= budget) continue;
        alive.sort((x, y) => x.weight - y.weight);
        for (const entry of alive.slice(0, alive.length - budget)) {
          removedKeys.add(entry.key);
          changed = true;
        }
      }
    }
    const limitedEdges = edges
      .filter((edge) => !removedKeys.has(keyOf(edge)))
      .sort((x, y) => y.weight - x.weight);

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
          avatar_fallback: node.avatarFallback,
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
   * 指定メンバーとの絡み (交流ネットワーク用)。
   * weight = 同じチャンネルでの発言量の重なり分 Σ min(自分の発言数, 相手の発言数)。
   */
  const graphPartners = async (c: Context, isAll: boolean) => {
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
    const headers = { "Cache-Control": "no-store" };
    const ckey = `graph_part_${guild.guildId}_${userId}_${isAll ? "all" : `${yearParam}_${monthParam}`}`;
    const cached = cache.get(ckey);
    if (cached !== undefined) return jsonResponse(cached, 200, headers);

    const pool = deps.getPool();
    if (!pool) return jsonError(503, "Service unavailable.");

    const baseParams: unknown[] = [guild.guildId, userId];
    let periodFilter = "";
    if (startDate && endDate) {
      baseParams.push(startDate, endDate);
      periodFilter = "AND m.created_at >= $3 AND m.created_at < $4";
    }

    const [profileRes, partnerRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(gm.display_name, u.display_name, u.username) AS display_name,
                u.username, u.avatar_url, u.avatar_decoration_url, count(*) AS c
         FROM messages m
         JOIN users u ON u.user_id = m.user_id
         LEFT JOIN guild_members gm ON gm.guild_id = m.guild_id AND gm.user_id = m.user_id
         WHERE m.guild_id = $1 AND m.user_id = $2 AND m.is_bot = FALSE ${periodFilter}
         GROUP BY u.user_id, u.display_name, u.username, u.avatar_url, u.avatar_decoration_url, gm.display_name`,
        baseParams,
      ),
      pool.query(
        `WITH own AS (
           SELECT m.channel_id, count(*) AS c
           FROM messages m
           WHERE m.guild_id = $1 AND m.user_id = $2 AND m.is_bot = FALSE ${periodFilter}
           GROUP BY m.channel_id
         ),
         others AS (
           SELECT m.user_id, m.channel_id, count(*) AS c
           FROM messages m
           WHERE m.guild_id = $1 AND m.user_id <> $2 AND m.is_bot = FALSE ${periodFilter}
           GROUP BY m.user_id, m.channel_id
         )
         SELECT o.user_id, SUM(LEAST(x.c, o.c)) AS w
         FROM others o
         JOIN own x ON x.channel_id = o.channel_id
         WHERE o.c >= 1
         GROUP BY o.user_id
         HAVING SUM(LEAST(x.c, o.c)) >= 1
         ORDER BY w DESC
         LIMIT 30`,
        baseParams,
      ),
    ]);

    const profile = profileRes.rows[0] as Record<string, unknown> | undefined;
    if (!profile) {
      cache.set(ckey, { center: null, partners: [] }, ttl);
      return jsonResponse({ center: null, partners: [] }, 200, headers);
    }

    const partnerIds = (partnerRes.rows as Array<Record<string, unknown>>).map((row) =>
      String(row.user_id),
    );
    let partnerProfiles = new Map<string, Record<string, unknown>>();
    if (partnerIds.length > 0) {
      const { rows: profileRows } = await pool.query(
        `SELECT gm.user_id, COALESCE(gm.display_name, u.display_name, u.username) AS display_name,
                u.username, u.avatar_url, u.avatar_decoration_url
         FROM guild_members gm
         JOIN users u ON u.user_id = gm.user_id
         WHERE gm.guild_id = $1 AND gm.user_id = ANY($2::bigint[])
           AND u.username NOT ILIKE 'deleted%user'
           AND gm.display_name NOT ILIKE 'deleted%user'
           AND u.display_name NOT ILIKE 'deleted%user'`,
        [guild.guildId, partnerIds],
      );
      partnerProfiles = new Map(
        (profileRows as Array<Record<string, unknown>>).map((row) => [String(row.user_id), row]),
      );
    }

    const centerMessages = Number(profile.c ?? 0);
    const res = {
      center: {
        user_id: userId,
        display_name: (profile.display_name as string) || "Unknown",
        username: (profile.username as string) || "unknown",
        avatar: (profile.avatar_url as string | null) ?? null,
        avatar_decoration: (profile.avatar_decoration_url as string | null) ?? null,
        count: centerMessages,
      },
      partners: (partnerRes.rows as Array<Record<string, unknown>>)
        .map((row) => {
          const id = String(row.user_id);
          const prof = partnerProfiles.get(id);
          return {
            user_id: id,
            display_name: (prof?.display_name as string) || "Unknown",
            username: (prof?.username as string) || "unknown",
            avatar: (prof?.avatar_url as string | null) ?? null,
            avatar_decoration: (prof?.avatar_decoration_url as string | null) ?? null,
            weight: Number(row.w),
          };
        })
        .filter((partner) => partner.display_name !== "Unknown" || partner.username !== "unknown"),
    };
    cache.set(ckey, res, ttl);
    return jsonResponse(res, 200, headers);
  };

  app.get("/graph/partners/:userId/:year/:month", (c) => graphPartners(c, false));
  app.get("/graph/partners/:userId/total", (c) => graphPartners(c, true));

  /**
   * Caddy on-demand TLSのaskエンドポイント。
   * 登録済みかつ有効なギルドドメインのみ証明書発行を許可する (200=許可/404=拒否)。
   * ネットワーク的にVPSのCaddyからのみ到達可能であることを前提とする。
   */
}
