"use client";

import { useState } from "react";
import {
  NameplateText,
  ServerTagChip,
  UserAvatar,
  nameplateBackgroundStyle,
  type DiscordIdentity,
} from "./discord/DiscordIdentity";

/** Discordのデフォルトアバター (脱退ユーザー等でアイコンURLが読めなくなった場合の代替) */
const DEFAULT_AVATAR_URL = "https://cdn.discordapp.com/embed/avatars/1.png";

export function Avatar({
  src,
  alt = "",
  className = "",
}: {
  src?: string | null;
  alt?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = !src || failed ? DEFAULT_AVATAR_URL : src;
  return (
    <img
      src={resolvedSrc}
      alt={alt}
      onError={() => {
        if (resolvedSrc !== DEFAULT_AVATAR_URL) setFailed(true);
      }}
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  );
}

export interface RankEntry extends DiscordIdentity {
  user_id: string;
  display_name: string;
  count: number;
}

const RANK_STYLES = [
  "bg-amber-100 text-amber-700",
  "bg-gray-200 text-gray-600",
  "bg-orange-100 text-orange-700",
] as const;

export default function RankTopCard({
  title,
  note,
  unit = "回",
  items,
  max = 5,
  hrefBase,
  emptyText = "データがありません",
}: {
  title: string;
  note?: string;
  unit?: string;
  items: RankEntry[];
  max?: number;
  /** 指定時は各行がこのパス (ユーザーIDを連結) へのリンクになる */
  hrefBase?: string;
  emptyText?: string;
}) {
  return (
    <div className="app-card-padded flex h-full flex-col">
      <div>
        <p className="text-sm font-black text-foreground">{title}</p>
        {note && <p className="mt-0.5 text-xs font-bold text-muted-foreground">{note}</p>}
      </div>
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ol className="mt-3 flex-1 space-y-1">
          {items.slice(0, max).map((item, index) => {
            const rank = index + 1;
            const badge =
              rank <= 3 ? (
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs font-black ${RANK_STYLES[rank - 1]}`}
                >
                  {rank}
                </span>
              ) : (
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-black text-muted-foreground">
                  {rank}
                </span>
              );
            const body = (
              <>
                {badge}
                <span className="flex min-w-0 flex-1">
                  <span
                    style={nameplateBackgroundStyle(item.nameplate)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-0.5"
                  >
                    {/* 日付などユーザー以外のエントリー (avatar/decoration未指定) はアイコンなしで表示 */}
                    {(item.avatar !== undefined || item.avatar_decoration !== undefined) && (
                      <UserAvatar user={item} size={32} />
                    )}
                    <NameplateText name={item.display_name} className="max-w-full text-sm" />
                    <ServerTagChip tag={item.primary_guild_tag} badge={item.primary_guild_badge} />
                  </span>
                </span>
                <span className="text-sm font-black text-foreground">
                  {item.count.toLocaleString("ja-JP")}
                  <span className="ml-0.5 text-xs font-bold text-muted-foreground">{unit}</span>
                </span>
              </>
            );
            return hrefBase ? (
              <li key={item.user_id}>
                <a
                  href={`${hrefBase}${item.user_id}`}
                  className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted"
                >
                  {body}
                </a>
              </li>
            ) : (
              <li key={item.user_id} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
                {body}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
