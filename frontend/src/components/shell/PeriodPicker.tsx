"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, Infinity as InfinityIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { periodHref, latestPublishedMonth, recentMonths, type Period } from "@/lib/period";
import { fetchAPI } from "@/lib/api";

interface MonthCandidate {
  year: number;
  month: number;
  /** 月の発言件数 (取得失敗時のフォールバックでは不明のためnull) */
  count: number | null;
}

/** 月候補のキャッシュ (/stats/history/total = 日次データから月別件数を集計)。
 * backendのLIVE TTLは10分なのでクライアント側も10分で同期する */
const MONTH_COUNTS_TTL = 600000;
let monthCountsCache: { ts: number; months: Map<string, number> } | null = null;

/** 月→発言件数のマップを取得する。日次データは発言がある日だけ含まれるため、
 * データに存在しない月 = 発言0件の月 (候補から外す) として扱える */
async function fetchMonthCounts(): Promise<Map<string, number>> {
  if (monthCountsCache && Date.now() - monthCountsCache.ts < MONTH_COUNTS_TTL) {
    return monthCountsCache.months;
  }
  const res = await fetchAPI("/stats/history/total", { retries: 1, timeout: 60000 });
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as {
    chart_data?: Array<{ date: string; total: number }>;
  };
  const months = new Map<string, number>();
  for (const point of body.chart_data ?? []) {
    const [yearStr, monthStr] = point.date.split("-");
    if (!yearStr || !monthStr) continue;
    // YYYY-MM 形式に正規化 (月の桁を統一しないと辞書順比較が誤るため)
    const key = `${Number(yearStr)}-${String(Number(monthStr)).padStart(2, "0")}`;
    months.set(key, (months.get(key) ?? 0) + Number(point.total));
  }
  monthCountsCache = { ts: Date.now(), months };
  return months;
}

/** 月→件数のマップから、新しい順の候補リストを作る。
 * 0件の月は含めないが、選択中の月は0件でも一覧に残す (表示状態を分かるようにするため)。
 * 未公開の月 (今月など) は実データがあっても候補にしない */
function buildMonthCandidates(counts: Map<string, number>, selected: Period): MonthCandidate[] {
  const latest = latestPublishedMonth();
  const latestKey = `${latest.year}-${String(latest.month).padStart(2, "0")}`;
  const list: MonthCandidate[] = [...counts.entries()]
    .filter(([key]) => key <= latestKey)
    .map(([key, count]) => {
      const [year, month] = key.split("-").map(Number);
      return { year: year ?? 0, month: month ?? 0, count };
    })
    .filter((entry) => entry.year > 0 && entry.month > 0)
    .sort((a, b) => b.year - a.year || b.month - a.month);
  // 現在表示中の月が0件なら、選択状態が分かるように先頭に足す
  if (
    !selected.isAll &&
    selected.year !== null &&
    selected.month !== null &&
    !counts.has(`${selected.year}-${String(selected.month).padStart(2, "0")}`)
  ) {
    list.unshift({ year: selected.year, month: selected.month, count: 0 });
  }
  return list;
}

/**
 * 期間セレクタ。
 * - mode "path": 月別サマリー (/month/Y/M) と /all を切り替える
 * - mode "query": 現在のパスの m クエリを更新する
 */
export default function PeriodPicker({ period, mode }: { period: Period; mode: "path" | "query" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /** 月→発言件数のマップ。null = 未読み込み (メニュー表示中は「読み込み中…」) */
  const [monthCounts, setMonthCounts] = useState<Map<string, number> | null>(null);
  /** 取得失敗フラグ。trueのときは直近24ヶ月の固定リストにフォールバック */
  const [monthsFailed, setMonthsFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // 月選択メニューを開いたタイミングで、発言0件の月を除いた候補を読み込む
  useEffect(() => {
    if (!menuOpen || monthCounts || monthsFailed) return;
    let cancelled = false;
    fetchMonthCounts()
      .then((months) => {
        if (!cancelled) setMonthCounts(months);
      })
      .catch(() => {
        if (!cancelled) setMonthsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [menuOpen, monthCounts, monthsFailed]);

  /** ドロップダウンに表示する月候補。0件の月は含めない (選択中の月を除く) */
  const candidates: MonthCandidate[] = useMemo(() => {
    if (monthsFailed) {
      // 取得失敗時は固定の直近24ヶ月のフォールバック
      return recentMonths(24).map(({ year, month }) => ({ year, month, count: null }));
    }
    if (!monthCounts) return [];
    return buildMonthCandidates(monthCounts, period);
  }, [monthCounts, monthsFailed, period]);

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

      {/* 月選択ドロップダウン (全期間中は無効)。発言0件の月は候補に含めない */}
      <DropdownMenu onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          disabled={period.isAll}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground shadow-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {period.isAll ? "全期間" : `${period.year}年${period.month}月`}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
          {monthCounts === null && !monthsFailed ? (
            <DropdownMenuItem disabled className="text-sm font-bold text-muted-foreground">
              読み込み中…
            </DropdownMenuItem>
          ) : (
            candidates.map((candidate) => {
              const href = monthHref(candidate.year, candidate.month);
              const selected =
                !period.isAll && period.year === candidate.year && period.month === candidate.month;
              return (
                <DropdownMenuItem
                  key={`${candidate.year}-${candidate.month}`}
                  className={`justify-between text-sm font-bold ${selected ? "bg-muted" : ""}`}
                  onSelect={() => go(href)}
                >
                  {candidate.year}年{candidate.month}月
                  {selected && <span className="text-xs text-muted-foreground">表示中</span>}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
