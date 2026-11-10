import type { Context } from "hono";

/** 公開エンドポイント (レートリミットは適用されるがAPIキー不要) */
export const PUBLIC_PATHS = new Set(["/", "/health", "/docs", "/openapi.json", "/favicon.ico"]);
export const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const DB_HEAVY_PREFIXES = ["/ranking", "/stats", "/users", "/graph"];
export const LIVE_TOTAL_CACHE_TTL = 1800;
export const TOTAL_CACHE_WARM_INTERVAL_MS = 600 * 1000;

export const DELETED_USER_FILTER =
  "(u.user_id IS NOT NULL AND u.username NOT ILIKE 'deleted%user' AND u.display_name NOT ILIKE 'deleted%user')";

export function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  if (headers) {
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
export function jsonError(status: number, message: string, headers?: Record<string, string>): Response {
  return jsonResponse({ detail: message }, status, headers);
}
export function plainTextResponse(text: string, headers?: Record<string, string>, status = 200): Response {
  const responseHeaders = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  if (headers) {
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
  }
  return new Response(text, { status, headers: responseHeaders });
}
export function noContent(headers?: Record<string, string>): Response {
  const responseHeaders = new Headers();
  if (headers) {
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
  }
  return new Response(null, { status: 204, headers: responseHeaders });
}
export function defaultGetPeerIp(c: Context): string {
  return (c.env as { peerIp?: string } | undefined)?.peerIp ?? "unknown";
}
export async function readBodyCapped(request: Request, cap: number): Promise<Buffer | null> {
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
export function pathInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
export function jstYearMonth(date = new Date()): { year: number; month: number } {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).format(date);
  const [year, month] = formatted.split("-").map(Number);
  return { year, month };
}
export interface RankingItem {
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
export interface UserRankItem extends RankingItem {
  rank: number;
}
export interface QueryRow {
  [column: string]: unknown;
}
export function formatRankingResponse(rows: QueryRow[]): RankingItem[] {
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
export function formatUserRankResponse(row: QueryRow | undefined): UserRankItem | null {
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
export function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
export function monthBounds(year: number, month: number): Date[] | string {
  if (year < 2020 || year > 2100) return "year must be between 2020 and 2100";
  if (month < 1 || month > 12) return "month must be between 1 and 12";
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end =
    month === 12 ? new Date(Date.UTC(year + 1, 0, 1)) : new Date(Date.UTC(year, month, 1));
  return [start, end];
}
export function isDbHeavyPath(path: string): boolean {
  return DB_HEAVY_PREFIXES.some((prefix) => path.startsWith(prefix));
}
export function addChannelScopeFilter(
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
export function computeUserIdsKey(userIds: string[]): string {
  return userIds.length === 0 ? "None" : JSON.stringify(userIds);
}
export function parseEndDate(raw: string | undefined): Date | null | "invalid" {
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
