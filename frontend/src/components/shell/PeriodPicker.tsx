"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, Infinity as InfinityIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { periodHref, recentMonths, type Period } from "@/lib/period";

/**
 * 期間セレクタ。
 * - mode "path": 月別サマリー (/month/Y/M) と /all を切り替える
 * - mode "query": 現在のパスの m クエリを更新する
 */
export default function PeriodPicker({ period, mode }: { period: Period; mode: "path" | "query" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const go = (href: string) => router.push(href);

  const monthHref = (year: number, month: number): string => {
    if (mode === "path") return `/month/${year}/${month}`;
    const next = new URLSearchParams(searchParams.toString());
    const queryValue = `${year}-${month}`;
    const def = recentMonths(1)[0];
    if (queryValue === `${def.year}-${def.month}`) next.delete("m");
    else next.set("m", queryValue);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const allHref =
    mode === "path"
      ? "/all"
      : periodHref(pathname, { key: "all", year: null, month: null, isAll: true });
  const monthModeHref =
    mode === "path"
      ? "/month/latest"
      : periodHref(pathname, { key: "", year: null, month: null, isAll: false });

  return (
    <div className="flex items-center gap-2">
      {/* 月 / 全期間トグル */}
      <div className="flex rounded-xl border border-border bg-card p-1 shadow-xs">
        <button
          type="button"
          onClick={() => go(monthModeHref)}
          aria-pressed={!period.isAll}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            !period.isAll
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          月別
        </button>
        <button
          type="button"
          onClick={() => go(allHref)}
          aria-pressed={period.isAll}
          className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
            period.isAll
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <InfinityIcon className="h-3.5 w-3.5" aria-hidden="true" />
          全期間
        </button>
      </div>

      {/* 月選択ドロップダウン (全期間中は無効) */}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={period.isAll}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground shadow-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {period.isAll ? "全期間" : `${period.year}年${period.month}月`}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
          {recentMonths(24).map(({ year, month }) => {
            const href = monthHref(year, month);
            const selected = !period.isAll && period.year === year && period.month === month;
            return (
              <DropdownMenuItem
                key={`${year}-${month}`}
                className={`justify-between text-sm font-bold ${selected ? "bg-muted" : ""}`}
                onSelect={() => go(href)}
              >
                {year}年{month}月
                {selected && <span className="text-xs text-muted-foreground">表示中</span>}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
