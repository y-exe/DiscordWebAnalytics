import type { ReadonlyURLSearchParams } from "next/navigation";

export interface Period {
  /** "YYYY-MM" または "all" (全期間) */
  key: string;
  year: number | null;
  month: number | null;
  isAll: boolean;
}

/** JSTで現在の「最新公開月」(前月) を返す */
export function latestPublishedMonth(now = new Date()): { year: number; month: number } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  // UTC基準でJST月を取り、前月へ
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1; // 1-12
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function parsePeriod(raw: string | null | undefined, fallback?: Period): Period {
  if (raw === "all") return { key: "all", year: null, month: null, isAll: true };
  if (raw && /^\d{4}-(0?[1-9]|1[0-2])$/.test(raw)) {
    const [year, month] = raw.split("-").map(Number);
    return { key: `${year}-${month}`, year, month, isAll: false };
  }
  return fallback ?? defaultPeriod();
}

export function defaultPeriod(): Period {
  const { year, month } = latestPublishedMonth();
  return { key: `${year}-${month}`, year, month, isAll: false };
}

export function periodLabel(period: Period): string {
  if (period.isAll) return "全期間";
  return `${period.year}年${period.month}月`;
}

export function shortPeriodLabel(period: Period): string {
  if (period.isAll) return "全期間";
  return `${period.year}.${String(period.month).padStart(2, "0")}`;
}

/** 期間を表すクエリパラメータ値 (既定期間なら省略) */
export function periodQueryValue(period: Period): string | null {
  if (period.isAll) return "all";
  const def = defaultPeriod();
  return period.key === def.key ? null : period.key;
}

export function periodHref(
  pathname: string,
  period: Period,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams(extra ?? {});
  const m = periodQueryValue(period);
  if (m) params.set("m", m);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** 現在のsearchParamsから期間を解釈し、指定パス+期間のhrefを作る (nav用) */
export function hrefWithPeriod(
  pathname: string,
  searchParams: Pick<ReadonlyURLSearchParams, "get"> | null,
  targetPath: string,
): string {
  const m = searchParams?.get("m");
  const period = parsePeriod(m, m === undefined ? undefined : undefined);
  // parsePeriodのfallbackは既定期間。mが無いページ (月別サマリー) では既定期間扱い
  return periodHref(targetPath, period);
}

/** 直近nヶ月ぶんの月リスト (新しい順) */
export function recentMonths(
  count: number,
  now = new Date(),
): Array<{ year: number; month: number; key: string }> {
  const { year, month } = latestPublishedMonth(now);
  const list: Array<{ year: number; month: number; key: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    list.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      key: `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`,
    });
  }
  return list;
}

/** 前月 (サマリーの前期間比較用) */
export function previousMonthOf(period: Period): { year: number; month: number } | null {
  if (period.isAll || period.year === null || period.month === null) return null;
  return period.month === 1
    ? { year: period.year - 1, month: 12 }
    : { year: period.year, month: period.month - 1 };
}
