/** Discord CDN URL・ユーザー装飾データの共通ユーティリティ */

export interface Nameplate {
  asset: string;
  palette: string;
}

export interface DiscordIdentity {
  avatar?: string | null;
  avatar_decoration?: string | null;
  nameplate?: Nameplate | null;
  primary_guild_tag?: string | null;
  primary_guild_badge?: string | null;
}

export const NAMEPLATE_PALETTE_COLORS: Record<string, string> = {
  crimson: "#e8425a",
  berry: "#eb6f91",
  sky: "#5cb3f6",
  teal: "#35c5b0",
  forest: "#3ba55d",
  bubble_gum: "#f48fb5",
  violet: "#9b6ef3",
  cobalt: "#4e6cf6",
  clover: "#4fae6a",
  lemon: "#f0c64e",
  white: "#e8eaed",
};

export function paletteColor(palette: string | null | undefined): string {
  if (!palette) return NAMEPLATE_PALETTE_COLORS.white;
  return NAMEPLATE_PALETTE_COLORS[palette] ?? NAMEPLATE_PALETTE_COLORS.white;
}

/** Snowflake IDからアカウント作成日を求める (Discordエポック 2015-01-01) */
export function snowflakeToDate(snowflake: string): Date | null {
  if (!/^\d+$/.test(snowflake)) return null;
  try {
    const ms = Number(BigInt(snowflake) >> 22n) + 1420070400000;
    return new Date(ms);
  } catch {
    return null;
  }
}

export function formatDiscordDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
