import type { CSSProperties } from "react";
import { paletteColor, type DiscordIdentity } from "@/lib/discord-assets";

export type { DiscordIdentity };
import { Avatar } from "../RankTopCard";

/** アバター + アバター装飾 (装飾はアバターの約1.3倍で重ねる) */
export function UserAvatar({
  user,
  size = 32,
  className = "",
}: {
  user: Pick<DiscordIdentity, "avatar" | "avatar_fallback" | "avatar_decoration" | "user_id">;
  size?: number;
  className?: string;
}) {
  const decorationSize = Math.round(size * 1.3);
  return (
    <span
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Avatar
        src={user.avatar}
        fallbackSrc={user.avatar_fallback}
        userId={user.user_id}
        alt=""
        className="h-full w-full"
      />
      {user.avatar_decoration && (
        <img
          src={user.avatar_decoration}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
          style={{ width: decorationSize, height: decorationSize }}
        />
      )}
    </span>
  );
}

/** ネームプレートの背景 (行全体に適用するスタイル) */
export function nameplateBackgroundStyle(
  nameplate?: { asset: string; palette: string } | null,
): CSSProperties | undefined {
  if (!nameplate) return undefined;
  const color = paletteColor(nameplate.palette);
  return {
    backgroundColor: `${color}44`,
    backgroundImage: `url(${nameplate.asset})`,
    backgroundSize: "auto 100%",
    backgroundRepeat: "no-repeat",
    // 画像部分を右端に寄せる (中央配置だと余った部分に色だけの領域が出てしまうため)
    backgroundPosition: "right center",
  };
}

/** Discord風サーバータグチップ (バッジ + タグ文字) */
export function ServerTagChip({
  tag,
  badge,
  className = "",
}: {
  tag: string | null | undefined;
  badge?: string | null | undefined;
  className?: string;
}) {
  if (!tag) return null;
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-muted px-1.5 align-middle ${className}`}
      title={`サーバータグ: ${tag}`}
    >
      {badge && <img src={badge} alt="" className="h-3 w-3 shrink-0 object-contain" />}
      <span className="text-xs font-bold leading-none text-foreground">{tag}</span>
    </span>
  );
}

/** ネームプレート行上の表示名 */
export function NameplateText({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`truncate font-bold text-foreground ${className}`}>{name}</span>;
}

/** Discord本物のサーバーブーストアイコン (GuildBoost) */
export function BoostIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path
        fill="currentColor"
        d="M11.02 1.36c.56-.48 1.4-.48 1.96 0l6.48 5.45c.34.29.54.71.54 1.16v8.23c-.05.38-.24.74-.54 1l-6.48 5.44c-.53.45-1.3.48-1.86.09l-.1-.09-6.48-5.45c-.3-.25-.49-.6-.53-1L4 16.04V7.97c0-.45.2-.87.54-1.16l6.48-5.45ZM6.36 7.89a1 1 0 0 0-.36.76v6.7c0 .29.13.57.36.76l5 4.2a1 1 0 0 0 1.28 0l5-4.2a1 1 0 0 0 .36-.77V8.65a1 1 0 0 0-.36-.76l-5-4.2a1 1 0 0 0-1.28 0l-5 4.2Z"
      />
      <path
        fill="currentColor"
        d="M11.36 6.3a1 1 0 0 1 1.28 0l3 2.52a1 1 0 0 1 .36.76v4.84a1 1 0 0 1-.36.76l-3 2.53a1 1 0 0 1-1.28 0l-3-2.53a1 1 0 0 1-.36-.76V9.58a1 1 0 0 1 .36-.76l3-2.53Z"
      />
    </svg>
  );
}

/** サーバーブースト中表示 (Discord同様ロゴのみ) */
export function BoostBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center align-middle text-pink-500 ${className}`}
      title="サーバーブースター"
    >
      <BoostIcon className="h-3.5 w-3.5" />
    </span>
  );
}
