"use client";

import { useEffect, useState } from "react";
import { LogIn, UserRound } from "lucide-react";
import LoginDialog from "./LoginDialog";

export interface LoggedInUser {
  id: string;
  name: string;
  avatar: string;
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
  };
}

export function logout(): void {
  ["user_id", "user_name", "user_avatar"].forEach((name) => {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
  });
  window.dispatchEvent(new Event("ymkw:auth-changed"));
}

export default function UserArea() {
  const [user, setUser] = useState<LoggedInUser | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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

  return (
    <>
      {user ? (
        <button
          type="button"
          onClick={logout}
          title="ログアウト"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-sidebar-hover"
        >
          {user.avatar ? (
            <img src={user.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sidebar-active">
              <UserRound className="h-4 w-4 text-sidebar-text-strong" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-sidebar-text-strong">
              {user.name || "ログイン中"}
            </span>
            <span className="block text-[10px] text-sidebar-text/60">クリックでログアウト</span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-strong"
        >
          <LogIn className="h-4 w-4" />
          ログイン
        </button>
      )}
      <LoginDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
