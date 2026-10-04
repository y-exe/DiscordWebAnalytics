"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home } from "lucide-react";
import FooterSection from "./FooterSection";
import LoginModal from "./LoginModal";
import MobileNavigation from "./MobileNavigation";
import SidebarContent from "./SidebarContent";
import ThemeProvider from "./ThemeProvider";
import { LoginButton } from "./AuthButtons";
import DashboardLoadingScreen from "./DashboardLoadingScreen";

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const parts = pathname.split("/").filter(Boolean);
  const isAll = parts[0] === "all";
  const isMonth = parts[0] === "month";
  const currentPath = pathname;
  const queryString = searchParams?.toString() ?? "";
  const queryParams = queryString ? `?${queryString}` : "";

  return (
    <ThemeProvider>
      <DashboardLoadingScreen />
      <aside className="dark w-80 h-screen fixed left-0 top-0 bg-background border-r border-border hidden md:flex flex-col z-50 text-foreground">
        <div className="p-8 pb-6">
          <Link href="/" className="flex items-center gap-4 hover:opacity-80 transition-opacity">
            <img src="/ymkw.webp" alt="やまかわてるき鯖" className="w-12 h-12 rounded-xl shadow-lg" />
            <div><h1 className="font-bold text-base text-foreground leading-tight">やまかわてるき鯖</h1><p className="text-xs text-muted-foreground mt-0.5">分析ダッシュボード</p></div>
          </Link>
        </div>
        <SidebarContent currentPath={currentPath} queryParams={queryParams} pageMode={isAll ? "open" : "month"} currentId={parts[1]} currentMonth={parts[2]} />
      </aside>

      <div className="md:hidden"><MobileNavigation currentPath={currentPath} queryParams={queryParams} /></div>
      <div className="flex-1 min-w-0 md:ml-80 flex flex-col transition-all mobile-content-pt relative">
        <header className="h-16 bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60 border-b border-border hidden md:flex items-center justify-between px-8 sticky top-0 z-40">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="パンくず">
            <Link href="/" className="flex items-center gap-1.5 hover:text-foreground"><Home className="w-4 h-4" />ホーム</Link><span>/</span>
            <span>{isAll ? "総合" : "月別"}</span>
            {isMonth && <><span>/</span><span className="text-foreground">{parts[1]}年 {parts[2]}月</span></>}
          </nav>
          <LoginButton />
        </header>
        <main className="px-4 md:px-8 lg:px-12 lg:pt-0 lg:pb-0 flex-1 bg-white">{children}</main>
        <FooterSection />
      </div>
      <LoginModal />
    </ThemeProvider>
  );
}
