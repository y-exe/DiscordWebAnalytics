import { fetchAPI } from "./api";

export interface GuildContextInfo {
  guildId: string;
  name: string;
  iconUrl: string | null;
  isDefault: boolean;
  /** ダッシュボードの代表ドメインのURL基点 (例: https://analytics.ymkw.top)。未登録ならnull */
  domain: string | null;
  /** 登録済みドメイン一覧 */
  domains: string[];
}

const FALLBACK: GuildContextInfo = {
  guildId: "",
  name: "",
  iconUrl: null,
  isDefault: true,
  domain: null,
  domains: [],
};

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: GuildContextInfo; expiresAt: number }>();

/** SSR時に元リクエストのホストを取得する (静的生成時などはnull) */
async function requestHost(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const incoming = await headers();
    return incoming.get("x-forwarded-host") ?? incoming.get("host");
  } catch {
    return null;
  }
}

/**
 * 現在のリクエストのギルド情報を取得する。
 * サーバーではホスト単位で短時間キャッシュし、失敗時は汎用ブランディングへフォールバックする。
 */
export async function getGuildContext(): Promise<GuildContextInfo> {
  const host = (await requestHost()) ?? "";
  const cacheKey = host || "__default__";
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  let value = FALLBACK;
  try {
    const response = await fetchAPI("/guild-context", { retries: 0, cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as Partial<GuildContextInfo>;
      value = {
        guildId: String(body.guildId ?? ""),
        name: String(body.name ?? ""),
        iconUrl: body.iconUrl ?? null,
        isDefault: body.isDefault !== false,
        domain: body.domain ?? null,
        domains: Array.isArray(body.domains) ? body.domains.map(String) : [],
      };
    }
  } catch {
    // バックエンドが利用できない場合はフォールバック (ビルド時など)
  }

  if (cache.size >= 200) cache.clear();
  cache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/**
 * ダッシュボードの絶対URL基点 (canonical・OGP・埋め込みリンク用)。
 * 配信中のホストがギルドの登録ドメインならそれを優先し、
 * そうでなければ代表ドメイン、未解決ならnull。
 */
export async function getGuildBaseUrl(): Promise<string | null> {
  const [guild, host] = await Promise.all([getGuildContext(), requestHost()]);
  const normalized = host?.split(",")[0]?.trim().toLowerCase();
  if (normalized && guild.domains.includes(normalized)) return `https://${normalized}`;
  return guild.domain;
}

export { FALLBACK as FALLBACK_GUILD_CONTEXT };
