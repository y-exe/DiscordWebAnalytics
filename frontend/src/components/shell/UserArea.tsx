"use client";

import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import {
  BoostBadge,
  ServerTagChip,
  UserAvatar,
  nameplateBackgroundStyle,
} from "@/components/views/discord/DiscordIdentity";
import { fetchAPI } from "@/lib/api";
import type { GuildBrand } from "./AppShell";
import LoginDialog from "./LoginDialog";

export interface LoggedInUser {
  id: string;
  name: string;
  avatar: string;
  avatarFallback: string;
}

/** メンバー詳細 (/users/:id/insights) のプロフィール部分。
 * クライアントは本番APIを直接参照するため、既存エンドポイントを流用する */
interface LoggedInProfile {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  avatar_decoration: string | null;
  nameplate: { asset: string; palette: string } | null;
  primary_guild_tag: string | null;
  primary_guild_badge: string | null;
  premium_since: string | null;
}

export function getLoggedInUser(): LoggedInUser | null {
  if (typeof window === "undefined") return null;
  const cookies = document.cookie.split("; ").reduce<Record<string, string>>((all, entry) => {
    const separator = entry.indexOf("=");
    if (separator !== -1) all[entry.slice(0, separator)] = entry.slice(separator + 1);
    return all;
  }, {});
  const id = cookies.user_id ? decodeURIComponent(cookies.user_id) : "";
  if (!id || id === "guest") return null;
  return {
    id,
    name: cookies.user_name ? decodeURIComponent(cookies.user_name) : "",
    avatar: cookies.user_avatar ? decodeURIComponent(cookies.user_avatar) : "",
    avatarFallback: cookies.user_avatar_fallback
      ? decodeURIComponent(cookies.user_avatar_fallback)
      : "",
  };
}

export function logout(): void {
  ["user_id", "user_name", "user_avatar", "user_avatar_fallback"].forEach((name) => {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
  });
  window.dispatchEvent(new Event("ymkw:auth-changed"));
}

/** ログアウト確認ポップアップ (テーマに追従) */
function LogoutConfirm({
  open,
  name,
  username,
  onClose,
  onConfirm,
}: {
  open: boolean;
  name: string;
  username: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        // ポップアップ外の背景クリックで閉じる
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xs rounded-2xl border border-border bg-canvas p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="ログアウト確認"
      >
        <p className="text-base font-black text-foreground">ログアウトしますか?</p>
        <div className="mt-3 flex min-w-0 items-center gap-2.5 rounded-xl bg-muted px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-foreground">{name}</span>
            <span className="block truncate text-[10px] text-muted-foreground">@{username}</span>
          </span>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-muted px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted/80"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-foreground px-3 py-2 text-sm font-bold text-background transition-opacity hover:opacity-90"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UserArea({ guild }: { guild: GuildBrand }) {
  const [user, setUser] = useState<LoggedInUser | null>(null);
  const [profile, setProfile] = useState<LoggedInProfile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const sync = () => setUser(getLoggedInUser());
    sync();
    window.addEventListener("ymkw:auth-changed", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("ymkw:auth-changed", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // ログイン中ユーザーの詳細プロフィールを取得 (メンバー一覧と同じ仕様で表示する)
  const profileKey = user && /^\d+$/.test(user.id) ? user.id : null;
  useEffect(() => {
    if (!profileKey) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    fetchAPI(`/users/${profileKey}/insights/total`, { retries: 0 })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { user: LoggedInProfile | null };
        if (!cancelled && body?.user) setProfile(body.user);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profileKey]);

  return (
    <>
      {user ? (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          title="ログアウト"
          style={nameplateBackgroundStyle(profile?.nameplate)}
          className="flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-sidebar-hover"
        >
          {/* メンバー一覧と同様: アバター+装飾・タグ・ブーストを表示する */}
          <UserAvatar
            user={{
              user_id: user.id,
              avatar: profile?.avatar ?? user.avatar,
              avatar_fallback: profile ? null : user.avatarFallback || null,
              avatar_decoration: profile?.avatar_decoration ?? null,
            }}
            size={40}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="block truncate text-xs font-bold text-sidebar-text-strong">
                {profile?.display_name || user.name || "ログイン中"}
              </span>
              <ServerTagChip
                tag={profile?.primary_guild_tag ?? null}
                badge={profile?.primary_guild_badge ?? null}
              />
              {profile?.premium_since && <BoostBadge />}
            </span>
            <span className="block truncate text-[10px] text-sidebar-text/60">
              {profile ? `@${profile.username}` : "クリックでログアウト"}
            </span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-strong"
        >
          <LogIn className="h-4 w-4" />
          ログイン
        </button>
      )}
      <LoginDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        guild={{ name: guild.name, iconUrl: guild.iconUrl }}
      />
      {user && (
        <LogoutConfirm
          open={confirmOpen}
          name={profile?.display_name || user.name || "ログイン中"}
          username={profile?.username ?? ""}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => {
            logout();
            setConfirmOpen(false);
          }}
        />
      )}
    </>
  );
}
