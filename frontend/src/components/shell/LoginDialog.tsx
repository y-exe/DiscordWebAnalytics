"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { ServerTagChip, UserAvatar } from "@/components/views/discord/DiscordIdentity";
import { fetchAPI } from "@/lib/api";

export interface LoginDialogGuild {
  name: string;
  iconUrl: string | null;
}

interface SearchUser {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  /** ギルド用アイコンが読めない (退出等) 場合の代替: メインのアバター */
  avatar_fallback?: string | null;
  avatar_decoration?: string | null;
  nameplate?: { asset: string; palette: string } | null;
  primary_guild_tag?: string | null;
  primary_guild_badge?: string | null;
}

export default function LoginDialog({
  open,
  onClose,
  guild,
}: {
  open: boolean;
  onClose: () => void;
  guild: LoginDialogGuild;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSearch = async (value: string) => {
    setQuery(value);
    if (value.trim().length > 0) {
      setLoading(true);
      try {
        const res = await fetchAPI(`/users/search?q=${encodeURIComponent(value.trim())}`, {
          retries: 0,
        });
        if (res.ok) setResults((await res.json()) as SearchUser[]);
      } catch {
        // 検索失敗時は結果なし扱い
      } finally {
        setLoading(false);
      }
    } else {
      setResults([]);
    }
  };

  const setCookie = (name: string, value: string) => {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=604800; SameSite=Lax`;
  };

  const handleLogin = (user: SearchUser) => {
    setCookie("user_id", user.user_id);
    setCookie("user_name", user.display_name);
    setCookie("user_avatar", user.avatar || "");
    setCookie("user_avatar_fallback", user.avatar_fallback || "");
    onClose();
    window.dispatchEvent(new Event("ymkw:auth-changed"));
  };

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={(e) => {
        // ポップアップ外の背景クリックで閉じる
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-canvas shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="ユーザー選択"
      >
        <div className="flex items-start justify-between border-b border-border p-5">
          <div className="flex items-center gap-3">
            {guild.iconUrl ? (
              <img src={guild.iconUrl} alt="" className="h-10 w-10 rounded-xl object-cover" />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-base font-black text-foreground">
                {guild.name ? guild.name.slice(0, 1) : "#"}
              </div>
            )}
            <div>
              <p className="text-base font-black text-foreground">メンバーを選択</p>
              <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                このサーバーの表示名またはユーザー名で検索します
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              placeholder="ユーザー名で検索..."
              className="w-full rounded-xl border border-input bg-muted py-2 pl-10 pr-4 text-sm transition-all placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <div className="h-[min(24rem,60dvh)] space-y-1 overflow-y-auto custom-scrollbar">
            {loading && <p className="py-6 text-center text-sm text-muted-foreground">検索中...</p>}
            {!loading &&
              results.map((user) => (
                <button
                  key={user.user_id}
                  type="button"
                  onClick={() => handleLogin(user)}
                  className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-muted"
                >
                  <UserAvatar user={user} size={36} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-foreground">
                        {user.display_name}
                      </span>
                      <ServerTagChip
                        tag={user.primary_guild_tag}
                        badge={user.primary_guild_badge}
                      />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{user.username}
                    </span>
                  </span>
                </button>
              ))}
            {!loading && results.length === 0 && query.trim() && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                ユーザーが見つかりません。
                <br />
                (Botの同期が完了していない可能性があります)
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
