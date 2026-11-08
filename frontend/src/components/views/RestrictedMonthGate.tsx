"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Lock } from "lucide-react";
import { fetchAPI } from "@/lib/api";

/**
 * 公開前の月 (当月) を管理者が閲覧するためのゲート。
 * パスワード認証 (/admin/login) が成功したら子要素を表示する。
 */
export default function RestrictedMonthGate({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checkSession = useCallback(() => {
    fetchAPI("/admin/session", { retries: 0, credentials: "include" })
      .then((res) => setState(res.ok ? "open" : "locked"))
      .catch(() => setState("locked"));
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchAPI("/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
        retries: 0,
      });
      if (res.ok) {
        setState("open");
        setPassword("");
      } else if (res.status === 429) {
        setError("試行回数が多すぎます。しばらく待ってから再試行してください。");
      } else {
        setError("パスワードが違います。");
      }
    } catch {
      setError("ログインに失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  if (state === "open") return <>{children}</>;

  if (state === "checking") {
    return <div className="h-64 animate-pulse rounded-2xl bg-muted" />;
  }

  return (
    <div className="app-card-padded mx-auto max-w-md text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-muted">
        <Lock className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-base font-black text-foreground">{label}はまだ公開されていません</p>
      <p className="mt-1 text-sm text-muted-foreground">
        管理者パスワードでログインすると閲覧できます。
      </p>
      <form onSubmit={handleLogin} className="mt-5 space-y-3">
        <div className="relative">
          <KeyRound className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="管理者パスワード"
            autoComplete="current-password"
            className="h-10 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </div>
        {error && <p className="text-xs font-bold text-delta-down">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="h-10 w-full rounded-xl bg-foreground text-sm font-black text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "確認中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}
