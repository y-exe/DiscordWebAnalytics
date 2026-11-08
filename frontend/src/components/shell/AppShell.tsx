"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  ChartColumn,
  GitCompareArrows,
  Hash,
  Menu,
  Moon,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { periodHref, parsePeriod, type Period } from "@/lib/period";
import UserArea from "./UserArea";

export interface GuildBrand {
  name: string;
  iconUrl: string | null;
  isDefault: boolean;
}

const NAV_ITEMS = [
  { key: "summary", label: "サマリー", Icon: ChartColumn },
  { key: "channels", label: "チャンネル", Icon: Hash },
  { key: "members", label: "メンバー", Icon: Users },
  { key: "compare", label: "比較", Icon: GitCompareArrows },
  { key: "stats", label: "統計", Icon: BarChart3 },
] as const;

/** 現在のURLから期間とパスモードを解決する */
export function resolveCurrentPeriod(
  pathname: string,
  mParam: string | null,
): { period: Period; mode: "path" | "query" } {
  const monthMatch = /^\/month\/(\d{4})\/(\d{1,2})$/.exec(pathname);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    return { period: { key: `${year}-${month}`, year, month, isAll: false }, mode: "path" };
  }
  if (pathname === "/all") {
    return { period: { key: "all", year: null, month: null, isAll: true }, mode: "path" };
  }
  return { period: parsePeriod(mParam), mode: "query" };
}

function navHref(itemKey: string, period: Period): string {
  if (itemKey === "summary") {
    if (period.isAll) return "/all";
    if (period.year && period.month) return `/month/${period.year}/${period.month}`;
    return "/month/latest";
  }
  const path = itemKey === "channels" ? "/channels" : `/${itemKey}`;
  return periodHref(path, period);
}

function isNavActive(itemKey: string, pathname: string): boolean {
  if (itemKey === "summary")
    return pathname === "/" || pathname.startsWith("/month") || pathname === "/all";
  return pathname.startsWith(`/${itemKey}`);
}

function NavList({
  pathname,
  period,
  onNavigate,
}: {
  pathname: string;
  period: Period;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="メインナビゲーション" className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map(({ key, label, Icon }) => {
        const active = isNavActive(key, pathname);
        return (
          <Link
            key={key}
            href={navHref(key, period)}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
              active
                ? "bg-sidebar-active text-sidebar-text-strong"
                : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-strong"
            }`}
          >
            <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "ライトテーマに切替" : "ダークテーマに切替"}
      className="flex h-9 w-9 items-center justify-center rounded-xl text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-strong"
    >
      {dark ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
    </button>
  );
}

function SidebarBody({
  guild,
  pathname,
  period,
  onNavigate,
}: {
  guild: GuildBrand;
  pathname: string;
  period: Period;
  onNavigate?: () => void;
}) {
  const name = guild.name || "ダッシュボード";
  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pb-5 pt-6">
        <Link
          href="/month/latest"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-xl hover:opacity-80 transition-opacity"
        >
          {guild.iconUrl ? (
            <img src={guild.iconUrl} alt="" className="h-10 w-10 rounded-xl object-cover" />
          ) : (
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-sidebar-active">
              <ChartColumn className="h-5 w-5 text-sidebar-text-strong" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-sidebar-text-strong">
              {name}
            </p>
            <p className="text-[11px] font-bold text-sidebar-text">Discord Analytics</p>
          </div>
        </Link>
      </div>
      <NavList pathname={pathname} period={period} onNavigate={onNavigate} />
      <div className="mx-3 mt-auto flex items-center justify-between rounded-xl px-1 pb-4 pt-6">
        <UserArea />
        <ThemeToggle />
      </div>
    </div>
  );
}

export default function AppShell({
  guild = { name: "", iconUrl: null, isDefault: true },
  children,
}: {
  guild?: GuildBrand;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [mParam, setMParam] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // searchParamsはSuspense要件を避けるため軽量に読む (期間パラメータのみ)
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("m");
    setMParam(m);
    setDrawerOpen(false);
  }, [pathname, router]);

  const { period } = resolveCurrentPeriod(pathname, mParam);

  return (
    <div className="min-h-screen bg-canvas">
      {/* デスクトップサイドバー */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarBody guild={guild} pathname={pathname} period={period} />
      </aside>

      {/* モバイルトップバー */}
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-sidebar-border bg-sidebar px-4 md:hidden">
        <button
          type="button"
          aria-label="メニューを開く"
          onClick={() => setDrawerOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-sidebar-text-strong hover:bg-sidebar-hover"
        >
          <Menu className="h-5 w-5" />
        </button>
        <p className="truncate text-sm font-bold text-sidebar-text-strong">
          {guild.name || "ダッシュボード"}
        </p>
        <ThemeToggle />
      </header>

      {/* モバイルドロワー */}
      {drawerOpen && (
        <div className="fixed inset-0 z-100 md:hidden">
          <button
            type="button"
            aria-label="メニューを閉じる"
            className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar shadow-2xl">
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-4 flex h-9 w-9 items-center justify-center rounded-xl text-sidebar-text hover:bg-sidebar-hover"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarBody
              guild={guild}
              pathname={pathname}
              period={period}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="md:pl-64">
        <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 md:px-8 md:pt-8">{children}</main>
      </div>
    </div>
  );
}
