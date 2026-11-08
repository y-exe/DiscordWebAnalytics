"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageToolbar from "@/components/shell/PageToolbar";
import PeriodPicker from "@/components/shell/PeriodPicker";
import StatCard from "./StatCard";
import RankTopCard from "./RankTopCard";
import HeatmapGrid from "./HeatmapGrid";
import Reorderable from "./Reorderable";
import { deltaRate } from "./DeltaBadge";
import { fetchAPI } from "@/lib/api";
import { periodLabel, previousMonthOf, type Period } from "@/lib/period";

interface RankingUser {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  avatar_decoration: string | null;
  nameplate: { asset: string; palette: string } | null;
  primary_guild_tag: string | null;
  primary_guild_badge: string | null;
  count: number;
  char_count: number;
}

interface ChartPoint {
  date: string;
  total: number;
  /** 1日のユニーク発言者数 (/stats/history の新フィールド。旧キャッシュでは欠落) */
  users?: number;
  /** 1日の合計文字数 (同上) */
  chars?: number;
}

interface Analysis {
  total: number;
  unique_users: number;
  char_count?: number;
  max_date: { date: string; count: number } | null;
  /** 発言数が多い日の上位5位 (旧キャッシュでは欠落) */
  top_dates?: { date: string; count: number }[];
  max_dow: { dow: number; count: number } | null;
  max_hour: { hour: number; count: number } | null;
}

interface HeatPoint {
  dow: number;
  hour: number;
  count: number;
}

interface PieItem {
  name: string;
  value: number;
}

function shortDate(date: string): string {
  const parts = date.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

export default function SummaryView({
  year,
  month,
  isAll,
}: {
  year: number | null;
  month: number | null;
  isAll: boolean;
}) {
  const [data, setData] = useState<{
    ranking: RankingUser[];
    chart: ChartPoint[];
    analysis: Analysis | null;
    prevAnalysis: Analysis | null;
    heatmap: HeatPoint[];
    channels: PieItem[];
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setFailed(false);
      try {
        const base = isAll ? "/total" : `/${year}/${month}`;
        const prev = previousMonthOf({ key: "", year, month, isAll });
        const prevBase = prev ? `/${prev.year}/${prev.month}` : null;
        const rankingPath = isAll ? "/ranking/total" : `/ranking/monthly/${year}/${month}`;
        const [rankRes, histRes, analysisRes, prevAnalysisRes, heatRes, pieRes] = await Promise.all(
          [
            fetchAPI(rankingPath),
            fetchAPI(`/stats/history${base}`),
            fetchAPI(`/stats/analysis${base}`),
            prevBase ? fetchAPI(`/stats/analysis${prevBase}`) : Promise.resolve(null),
            fetchAPI(`/stats/heatmap${base}`),
            fetchAPI(`/stats/channels_distribution${base}`),
          ],
        );
        if (cancelled) return;
        const ranking = rankRes.ok ? ((await rankRes.json()) as RankingUser[]) : [];
        const history = histRes.ok ? await histRes.json() : null;
        const analysis = analysisRes.ok ? ((await analysisRes.json()) as Analysis) : null;
        const prevAnalysis =
          prevAnalysisRes && prevAnalysisRes.ok
            ? ((await prevAnalysisRes.json()) as Analysis)
            : null;
        const heatmap = heatRes.ok ? ((await heatRes.json()) as HeatPoint[]) : [];
        const channels = pieRes.ok ? ((await pieRes.json()) as PieItem[]) : [];
        setData({
          ranking: Array.isArray(ranking) ? ranking : [],
          chart: history?.chart_data ?? [],
          analysis,
          prevAnalysis,
          heatmap,
          channels,
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [year, month, isAll]);

  const title = isAll
    ? "全期間"
    : periodLabel({ key: `${year}-${month}`, year, month, isAll: false });

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.chart.map((point) => ({ label: shortDate(point.date), 発言数: point.total }));
  }, [data]);

  const daysInPeriod = useMemo(() => {
    if (!year || !month) return null;
    if (isAll) {
      // 全期間: 実データが存在する最初〜最終日の日数で平均を取る
      const chart = data?.chart ?? [];
      if (chart.length === 0) return null;
      const dates = chart.map((point) => new Date(point.date).getTime());
      const days = Math.round((Math.max(...dates) - Math.min(...dates)) / 86400000) + 1;
      return days > 0 ? days : null;
    }
    return new Date(year, month, 0).getDate();
  }, [year, month, isAll, data]);

  if (failed) {
    return (
      <div className="app-card-padded text-center text-sm text-muted-foreground">
        データの読み込みに失敗しました。時間をおいて再読み込みしてください。
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-64 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  const total = data.analysis?.total ?? 0;
  const uniqueUsers = data.analysis?.unique_users ?? 0;
  const chars = data.analysis?.char_count ?? null;
  const prevTotal = data.prevAnalysis?.total ?? null;
  const prevUsers = data.prevAnalysis?.unique_users ?? null;
  const prevChars = data.prevAnalysis?.char_count ?? null;
  const avgPerDay = daysInPeriod && total > 0 ? total / daysInPeriod : null;
  const avgDelta =
    avgPerDay !== null && prevTotal !== null && daysInPeriod
      ? deltaRate(avgPerDay, prevTotal / daysInPeriod)
      : null;

  const topChannels = data.channels.slice(0, 6);
  const channelMax = topChannels[0]?.value ?? 1;

  const period: Period = { key: isAll ? "all" : `${year}-${month}`, year, month, isAll };

  return (
    <div className="space-y-5">
      <PageToolbar
        title={`${title}のサマリー`}
        subtitle="コミュニティの現状を把握しましょう"
        right={<PeriodPicker period={period} mode="path" />}
      />

      <Reorderable
        storageKey={isAll ? "layout.summary.all" : "layout.summary.month"}
        items={[
          {
            id: "kpis",
            node: (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="総発言数"
                  value={total}
                  unit="件"
                  delta={deltaRate(total, prevTotal)}
                  series={data.chart.map((p) => ({ label: shortDate(p.date), value: p.total }))}
                />
                <StatCard
                  title="アクティブメンバー"
                  value={uniqueUsers}
                  unit="人"
                  delta={deltaRate(uniqueUsers, prevUsers)}
                  series={
                    data.chart.some((p) => p.users !== undefined)
                      ? data.chart.map((p) => ({ label: shortDate(p.date), value: p.users ?? 0 }))
                      : undefined
                  }
                />
                <StatCard
                  title="総文字数"
                  value={chars ?? "—"}
                  unit={chars === null ? undefined : "字"}
                  delta={deltaRate(chars, prevChars)}
                  series={
                    data.chart.some((p) => p.chars !== undefined)
                      ? data.chart.map((p) => ({ label: shortDate(p.date), value: p.chars ?? 0 }))
                      : undefined
                  }
                />
                <StatCard
                  title="1日平均発言数"
                  value={avgPerDay === null ? "—" : Math.round(avgPerDay * 10) / 10}
                  unit="件"
                  delta={avgDelta}
                  chartType="bar"
                  series={data.chart
                    .slice(-14)
                    .map((p) => ({ label: shortDate(p.date), value: p.total }))}
                />
              </div>
            ),
          },
          {
            id: "trend",
            node: (
              <div className="app-card-padded">
                <p className="text-sm font-black text-foreground">日別の発言数推移</p>
                <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                  期間内の每日の発言数
                </p>
                <div className="mt-4 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e5e7eb" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: "#9ca3af" }}
                        minTickGap={28}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: "#9ca3af" }}
                        width={48}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid rgba(148,155,166,0.35)",
                          fontSize: 12,
                          fontWeight: 700,
                          background: "var(--app-canvas)",
                          color: "var(--app-sidebar-text-strong)",
                        }}
                        formatter={(value) => [`${Number(value).toLocaleString("ja-JP")}件`, ""]}
                        labelFormatter={(label) => String(label)}
                      />
                      <Area
                        type="monotone"
                        dataKey="発言数"
                        stroke="#3964fe"
                        strokeWidth={2.5}
                        fill="#3964fe"
                        fillOpacity={0.08}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ),
          },
          {
            id: "activity",
            node: (
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="app-card-padded xl:col-span-2">
                  <p className="text-sm font-black text-foreground">時間帯別アクティビティ</p>
                  <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                    曜日 × 時間帯の発言集中度
                  </p>
                  <div className="mt-4">
                    <HeatmapGrid data={data.heatmap} />
                  </div>
                </div>
                <div className="app-card-padded">
                  <p className="text-sm font-black text-foreground">チャンネル別発言シェア</p>
                  <p className="mt-0.5 mb-4 text-xs font-bold text-muted-foreground">
                    発言数の多いチャンネル トップ6
                  </p>
                  {topChannels.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      データがありません
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {topChannels.map((channel) => (
                        <li key={channel.name}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-bold">
                            <span className="truncate text-foreground">#{channel.name}</span>
                            <span className="shrink-0 text-muted-foreground">
                              {channel.value.toLocaleString("ja-JP")}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                            <div
                              className="h-full rounded-full bg-accent-data"
                              style={{
                                width: `${Math.max(4, Math.round((channel.value / channelMax) * 100))}%`,
                              }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ),
          },
          {
            id: "ranks",
            node: (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <RankTopCard
                  title="発言王"
                  note="この期間に最も発言したメンバー"
                  unit="件"
                  items={data.ranking.map((u) => ({
                    user_id: u.user_id,
                    display_name: u.display_name,
                    avatar: u.avatar,
                    avatar_decoration: u.avatar_decoration,
                    nameplate: u.nameplate,
                    primary_guild_tag: u.primary_guild_tag,
                    primary_guild_badge: u.primary_guild_badge,
                    count: u.count,
                  }))}
                  hrefBase="/members/"
                />
                <RankTopCard
                  title="文字数王"
                  note="最も多く文字を書いたメンバー"
                  unit="字"
                  items={[...data.ranking]
                    .sort((a, b) => b.char_count - a.char_count)
                    .map((u) => ({
                      user_id: u.user_id,
                      display_name: u.display_name,
                      avatar: u.avatar,
                      avatar_decoration: u.avatar_decoration,
                      nameplate: u.nameplate,
                      primary_guild_tag: u.primary_guild_tag,
                      primary_guild_badge: u.primary_guild_badge,
                      count: u.char_count,
                    }))}
                  hrefBase="/members/"
                />
                <RankTopCard
                  title="最多発言日"
                  note="期間内で最も盛り上がった日 トップ5"
                  unit="件"
                  emptyText="データがありません"
                  items={(
                    data.analysis?.top_dates ??
                    (data.analysis?.max_date ? [data.analysis.max_date] : [])
                  ).map((entry) => ({
                    user_id: `date-${entry.date}`,
                    display_name: entry.date.replaceAll("-", "/"),
                    count: entry.count,
                  }))}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
