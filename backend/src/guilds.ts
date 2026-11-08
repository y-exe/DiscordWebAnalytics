import type { Pool } from "pg";
import type { AppConfig } from "./config";

/** プラチャ総合など集約チャンネルのダミーID (フロントエンドと共有される慣習的な値) */
const PRIVATE_CHAT_CHANNEL_SENTINEL = "-1";

export interface GuildDisplayConfig {
  /** サイドバーに表示するチャンネル。空配列なら全チャンネルを表示する */
  whitelistChannelIds: string[];
  privateChatChannelId: string;
  /** このカテゴリ配下のチャンネルを「プラチャ」として集約する。空配列なら集約しない */
  privateChatCategoryIds: string[];
  /** 一覧の末尾に寄せて表示するカテゴリ */
  bottomChannelCategoryIds: string[];
}

export interface GuildContext {
  guildId: string;
  name: string;
  iconUrl: string | null;
  kingRoleId: string | null;
  excludedChannelIds: string[];
  displayConfig: GuildDisplayConfig;
  domains: string[];
  /** ダッシュボードの代表ドメイン (is_primary = TRUE) */
  primaryDomains: string[];
}

interface GuildRow {
  guild_id: string | bigint;
  name: string;
  icon_url: string | null;
  king_role_id: string | bigint | null;
  excluded_channel_ids: unknown;
  display_config: unknown;
  domains: string[] | null;
  primary_domains: string[] | null;
}

function parseId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text : null;
}

function parseIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => parseId(entry)).filter((entry): entry is string => entry !== null);
}

function parseDisplayConfig(raw: unknown): GuildDisplayConfig {
  const fallback: GuildDisplayConfig = {
    whitelistChannelIds: [],
    privateChatChannelId: PRIVATE_CHAT_CHANNEL_SENTINEL,
    privateChatCategoryIds: [],
    bottomChannelCategoryIds: [],
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const obj = raw as Record<string, unknown>;
  return {
    whitelistChannelIds: parseIdArray(obj.whitelistChannelIds),
    privateChatChannelId: PRIVATE_CHAT_CHANNEL_SENTINEL,
    privateChatCategoryIds: parseIdArray(obj.privateChatCategoryIds),
    bottomChannelCategoryIds: parseIdArray(obj.bottomChannelCategoryIds),
  };
}

function toGuildContext(row: GuildRow): GuildContext {
  return {
    guildId: String(row.guild_id),
    name: row.name,
    iconUrl: row.icon_url ?? null,
    kingRoleId: parseId(row.king_role_id),
    excludedChannelIds: parseIdArray(row.excluded_channel_ids),
    displayConfig: parseDisplayConfig(row.display_config),
    domains: Array.isArray(row.domains) ? row.domains.map(String) : [],
    primaryDomains: Array.isArray(row.primary_domains) ? row.primary_domains.map(String) : [],
  };
}

/** Hostヘッダーを正規化する (小文字化・ポート除去・x-forwarded-hostの連結対応) */
export function normalizeHost(raw: string | undefined | null): string {
  if (!raw) return "";
  let host = raw.split(",")[0].trim().toLowerCase();
  if (!host) return "";
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

const GUILD_BY_ID_SQL = `
  SELECT g.guild_id, g.name, g.icon_url, g.king_role_id, g.excluded_channel_ids, g.display_config,
         array_agg(d.domain ORDER BY d.domain) FILTER (WHERE d.domain IS NOT NULL) AS domains,
         array_agg(d.domain ORDER BY d.domain) FILTER (WHERE d.is_primary AND d.domain IS NOT NULL) AS primary_domains
  FROM guilds g
  LEFT JOIN guild_domains d ON d.guild_id = g.guild_id
  WHERE g.guild_id = $1
  GROUP BY g.guild_id`;

interface CacheEntry {
  guild: GuildContext | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1000;
const cache = new Map<string, CacheEntry>();

async function loadGuildById(pool: Pool, guildId: string): Promise<GuildContext | null> {
  const { rows } = await pool.query(GUILD_BY_ID_SQL, [guildId]);
  return rows.length > 0 ? toGuildContext(rows[0] as GuildRow) : null;
}

/**
 * Hostヘッダーからギルド設定を解決する。
 * - 空ホストや既定ホスト (api.ymkw.top 等) は既定ギルドへフォールバック (過渡期互換)
 * - 未登録ホストはnull (呼び出し元が404を返す)
 * - 結果はプロセス内キャッシュ (60秒) される
 */
export async function resolveGuildByHost(
  pool: Pool,
  config: AppConfig,
  rawHost: string | undefined | null,
): Promise<GuildContext | null> {
  const host = normalizeHost(rawHost);
  const isDefaultHost = host === "" || config.defaultGuildHosts.has(host);
  const cacheKey = isDefaultHost ? `default:${config.guildId}` : `domain:${host}`;

  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.guild;

  let guild: GuildContext | null = null;
  if (isDefaultHost) {
    guild = await loadGuildById(pool, config.guildId);
  } else {
    const { rows } = await pool.query("SELECT guild_id FROM guild_domains WHERE domain = $1", [
      host,
    ]);
    const guildId = rows.length > 0 ? parseId(rows[0].guild_id) : null;
    guild = guildId ? await loadGuildById(pool, guildId) : null;
  }

  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(cacheKey, { guild, expiresAt: now + CACHE_TTL_MS });
  return guild;
}

function preferApex(domains: string[]): string | null {
  const apex = domains.find((entry) => !entry.startsWith("www."));
  return apex ?? domains[0] ?? null;
}

/** ダッシュボードの絶対URL基点を組み立てる (代表ドメイン優先、未設定ならnull) */
export function dashboardBaseUrl(guild: GuildContext): string | null {
  const domain = preferApex(guild.primaryDomains) ?? preferApex(guild.domains);
  return domain ? `https://${domain}` : null;
}
