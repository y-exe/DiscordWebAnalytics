/** Discord CDN URL・ユーザー装飾データの共通ユーティリティ */

import type { CSSProperties } from "react";

export interface Nameplate {
  asset: string;
  palette: string;
}

export interface DiscordIdentity {
  user_id?: string | null;
  avatar?: string | null;
  /** avatarがギルド用で読めない (退出等) 場合に使うメインのアバターURL */
  avatar_fallback?: string | null;
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

/** Discord公式のデフォルトアバター (embed/avatars 0-5.png) の背景色。
 * 新ユーザー名方式では (user_id >> 22) % 6 でインデックスが決まる */
export const DEFAULT_AVATAR_COLORS: readonly string[] = [
  "#5865f2",
  "#757e8a",
  "#3ba55c",
  "#faa61a",
  "#ed4245",
  "#eb459f",
];

/** デフォルトバナー色導出用のインデックス ((user_id >> 22) % 6) */
function defaultAvatarColorIndex(userId: string | null | undefined): number | null {
  if (!userId || !/^\d+$/.test(userId)) return null;
  try {
    return Number((BigInt(userId) >> 22n) % 6n);
  } catch {
    return null;
  }
}

/** ユーザーIDから導出されるデフォルトのバナー色 (デフォルトアバターと同一パレット) */
export function defaultBannerColor(userId: string | null | undefined): string {
  const index = defaultAvatarColorIndex(userId) ?? 1;
  return DEFAULT_AVATAR_COLORS[index];
}

/** ユーザーIDから導出されるデフォルトのアバターURL ((user_id >> 22) % 6)。
 * 新ユーザー名方式ではアカウント作成時にこのインデックスで色が固定される */
export function defaultAvatarUrl(userId: string | null | undefined): string {
  const index = defaultAvatarColorIndex(userId) ?? 1;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** プロフィールバナーの背景スタイル。
 * 優先度: バナー画像 > accent_color (DB取得値) > ユーザーIDから導出したバナー色 */
export function profileBannerStyle(opts: {
  banner?: string | null;
  accentColor?: string | null;
  userId?: string | null;
}): CSSProperties {
  if (opts.banner) {
    return {
      backgroundImage: `url(${opts.banner})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  const color = opts.accentColor || defaultBannerColor(opts.userId);
  return { background: `linear-gradient(135deg, ${color}, ${color}cc)` };
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
