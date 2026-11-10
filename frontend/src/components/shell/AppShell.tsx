"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import {
  ChartColumn,
  GitCompareArrows,
  Hash,
  Menu,
  Moon,
  Share2,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { periodHref, parsePeriod, type Period } from "@/lib/period";
import { fetchAPI } from "@/lib/api";
import UserArea from "./UserArea";

export interface GuildBrand {
  name: string;
  iconUrl: string | null;
  isDefault: boolean;
}

/** サーバー名をクライアントコンポーネントに渡すためのコンテキスト */
const GuildNameContext = createContext<string>("");

/** 親Shellから提供されたサーバー名を取得する */
export function useGuildName(): string {
  return useContext(GuildNameContext);
}

const NAV_ITEMS = [
  { key: "summary", label: "統計", Icon: ChartColumn },
  { key: "members", label: "メンバー", Icon: Users },
  { key: "relation", label: "共通のかかわり", Icon: Share2 },
  { key: "compare", label: "比較", Icon: GitCompareArrows },
  { key: "channels", label: "チャンネル", Icon: Hash },
] as const;

interface SidebarChannel {
  id: string;
  name: string;
  category: string;
}

/** サイドバー下部のチャンネル一覧 (スレッドは親に集約済みなので除外) */
function useSidebarChannels(): SidebarChannel[] {
  const [channels, setChannels] = useState<SidebarChannel[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchAPI("/channels")
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as Array<{
          id: string;
          name: string;
          category: string;
        }>;
        if (cancelled) return;
        setChannels(
          body
            .filter((channel) => !channel.name.includes(" / "))
            .map((channel) => ({ id: channel.id, name: channel.name, category: channel.category })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return channels;
}

/** 現在のURL (mクエリ) から期間を解決する。クエリがない場合は最新公開月 */
export function resolveCurrentPeriod(mParam: string | null): Period {
  return parsePeriod(mParam);
}

function navHref(itemKey: string, period: Period): string {
  if (itemKey === "summary") {
    // サマリーはルート (+mクエリ) 形式に統一
    return periodHref("/", period);
  }
  const path = itemKey === "channels" ? "/channels" : `/${itemKey}`;
  return periodHref(path, period);
}

function isNavActive(itemKey: string, pathname: string): boolean {
  if (itemKey === "summary") return pathname === "/";
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
  const channels = useSidebarChannels();
  return (
    <nav aria-label="メインナビゲーション" className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map(({ key, label, Icon }) => {
        const active = isNavActive(key, pathname);
        return (
          <div key={key}>
            <Link
              href={navHref(key, period)}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-4 py-1.5 text-sm font-bold transition-colors ${
                active
                  ? "bg-sidebar-active text-sidebar-text-strong"
                  : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-strong"
              }`}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
              {label}
            </Link>
            {key === "channels" && channels.length > 0 && (
              <div className="mt-1">
                <div className="mx-1 border-t-2 border-sidebar-border" />
                <div className="mt-1 space-y-0.5 pb-1">
                  {channels.map((channel) => {
                    const channelActive =
                      pathname === `/channels/${channel.id}` ||
                      pathname.startsWith(`/channels/${channel.id}/`);
                    return (
                      <Link
                        key={channel.id}
                        href={`/channels/${channel.id}?m=${period.key}`}
                        onClick={onNavigate}
                        aria-current={channelActive ? "page" : undefined}
                        title={channel.name}
                        className={`flex min-w-0 items-center gap-3 rounded-xl px-4 py-1.5 text-sm font-bold transition-colors ${
                          channelActive
                            ? "bg-sidebar-active text-sidebar-text-strong"
                            : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-strong"
                        }`}
                      >
                        <Hash className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{channel.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
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
      {/* プロフィールの上までがスクロール領域。プロフィールは常に画面内に表示する */}
      <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        <div className="flex items-start justify-between px-6 pb-5 pt-6">
          <Link
            href={periodHref("/", period)}
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
          {/* モバイルのダークモード切替は上部バーにあるためドロワー内では非表示にする */}
          <div className="hidden md:block">
            <ThemeToggle />
          </div>
        </div>
        <NavList pathname={pathname} period={period} onNavigate={onNavigate} />
      </div>
      {/* 常時表示されるプロフィール (スクロール範囲外) */}
      <div className="shrink-0 border-t border-sidebar-border px-3 pb-4 pt-3">
        <UserArea guild={guild} />
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

  const period = resolveCurrentPeriod(mParam);

  return (
    <div className="min-h-screen bg-canvas">
      {/* デスクトップサイドバー */}
      <aside className="sidebar-dark fixed inset-y-0 left-0 z-50 hidden w-72 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarBody guild={guild} pathname={pathname} period={period} />
      </aside>

      {/* モバイルトップバー */}
      <header className="sidebar-dark sticky top-0 z-50 flex h-14 items-center justify-between border-b border-sidebar-border bg-sidebar px-4 md:hidden">
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
          <div className="sidebar-dark absolute inset-y-0 left-0 flex w-72 flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
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

      <div className="md:pl-72">
        <GuildNameContext value={guild.name}>
          <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 md:px-8 md:pt-8">
            {children}
          </main>
        </GuildNameContext>
      </div>
    </div>
  );
}
