import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { Pool } from "pg";
import {
  ADMIN_COOKIE_NAME,
  isApiClient,
  verifyAdminSession,
} from "../adminAuth";
import type { AppConfig } from "../config";
import { normalizeHost, resolveGuildByHost, type GuildContext } from "../guilds";
import { escapeLike, jsonError } from "../http";
import { isPublishedReportMonth } from "../../../shared/report-period";
import type { AppDeps } from "../types";

/** ルート群で共有するコンテキスト (deps由来の設定・キャッシュ・共通ヘルパー) */
export interface RouteHelpers {
  cfg: AppConfig;
  cache: AppDeps["cache"];
  deps: AppDeps;
  getPeerIp: (c: Context) => string;
  requireGuild: (c: Context) => Promise<GuildContext | Response>;
  getChannelScopeIds: (
    pool: Pool,
    guild: GuildContext,
    channelId: string | null,
  ) => Promise<string[] | null | Response>;
  requireMonthAccess: (
    c: Context,
    year: number,
    month: number,
  ) => { isRestricted: boolean } | { error: Response };
  monthCacheControl: (isRestricted: boolean) => Record<string, string>;
  adminRequestHost: (c: Context) => string | undefined;
}

export function createRouteHelpers(deps: AppDeps): RouteHelpers {
  const cfg = deps.config;
  const cache = deps.cache;
  const getPeerIp =
    deps.getPeerIp ??
    ((c: Context) => (c.env as { peerIp?: string } | undefined)?.peerIp ?? "unknown");

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
    // 公開月ルールは shared/report-period.ts と共通 (JST基準: 前月以前が公開)
    const isRestricted = !isPublishedReportMonth(year, month);
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

  return {
    cfg,
    cache,
    deps,
    getPeerIp,
    getChannelScopeIds,
    requireGuild,
    requireMonthAccess,
    monthCacheControl,
    adminRequestHost,
  };
}
