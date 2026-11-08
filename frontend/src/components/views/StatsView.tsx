"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PageToolbar from "@/components/shell/PageToolbar";
import PeriodPicker from "@/components/shell/PeriodPicker";
import StatCard from "./StatCard";
import HeatmapGrid from "./HeatmapGrid";
import Reorderable from "./Reorderable";
import { fetchAPI } from "@/lib/api";
import { periodLabel } from "@/lib/period";

interface Analysis {
  total: number;
  unique_users: number;
  char_count?: number;
  max_date: { date: string; count: number } | null;
  max_dow: { dow: number; count: number } | null;
  max_hour: { hour: number; count: number } | null;
}

interface HeatPoint {
  dow: number;
  hour: number;
  count: number;
}

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export default function StatsView({
  period,
}: {
  period: { key: string; year: number | null; month: number | null; isAll: boolean };
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [heatmap, setHeatmap] = useState<HeatPoint[]>([]);
  const [failed, setFailed] = useState(false);

  const analysisBase = period.isAll
    ? "/stats/analysis/total"
    : `/stats/analysis/${period.year}/${period.month}`;
  const heatBase = period.isAll
    ? "/stats/heatmap/total"
    : `/stats/heatmap/${period.year}/${period.month}`;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setAnalysis(null);
    setHeatmap([]);
    Promise.all([
      fetchAPI(analysisBase, { retries: 1 }).then(async (res) =>
        res.ok ? ((await res.json()) as Analysis) : null,
      ),
      fetchAPI(heatBase, { retries: 1 }).then(async (res) =>
        res.ok ? ((await res.json()) as HeatPoint[]) : [],
      ),
    ])
      .then(([analysisRes, heatRes]) => {
        if (cancelled) return;
        setAnalysis(analysisRes);
        setHeatmap(heatRes);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisBase, heatBase]);

  const dowData = useMemo(() => {
    if (!heatmap) return [];
    const map = new Map(heatmap.map((point) => [point.dow, point.count]));
    return DOW_LABELS.map((label, dow) => ({ label, 発言数: map.get(dow) ?? 0 }));
  }, [heatmap]);

  const hourData = useMemo(() => {
    if (!heatmap) return [];
    const map = new Map(heatmap.map((point) => [point.hour, point.count]));
    return Array.from({ length: 24 }, (_, hour) => ({
      label: String(hour),
      発言数: map.get(hour) ?? 0,
    }));
  }, [heatmap]);

  const title = period.isAll ? "全期間" : periodLabel(period);

  if (failed) {
    return (
      <div className="app-card-padded text-center text-sm text-muted-foreground">
        データの読み込みに失敗しました。
      </div>
    );
  }

  return (
    <div>
      <PageToolbar
        title="統計"
        subtitle={`${title}の活動データを詳しく掘り下します`}
        right={<PeriodPicker period={period} mode="query" />}
      />

      <Reorderable
        storageKey={period.isAll ? "layout.stats.all" : "layout.stats.month"}
        items={[
          {
            id: "kpis",
            node: (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="総発言数"
                  value={analysis?.total ?? "—"}
                  unit={analysis ? "件" : undefined}
                />
                <StatCard
                  title="アクティブメンバー"
                  value={analysis?.unique_users ?? "—"}
                  unit={analysis ? "人" : undefined}
                />
                <StatCard
                  title="最多発言日"
                  value={analysis?.max_date ? analysis.max_date.date.replaceAll("-", "/") : "—"}
                  unit={
                    analysis?.max_date
                      ? `${analysis.max_date.count.toLocaleString("ja-JP")}件`
                      : undefined
                  }
                />
                <StatCard
                  title="ピーク時間帯"
                  value={analysis?.max_hour ? `${analysis.max_hour.hour}:00台` : "—"}
                  unit={
                    analysis?.max_hour
                      ? `${analysis.max_hour.count.toLocaleString("ja-JP")}件`
                      : undefined
                  }
                />
              </div>
            ),
          },
          {
            id: "heatmap",
            node: (
              <div className="app-card-padded">
                <p className="text-sm font-black text-foreground">時間帯別アクティビティ</p>
                <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                  曜日 × 時間帯の発言集中度
                </p>
                <div className="mt-4">
                  <HeatmapGrid data={heatmap} />
                </div>
              </div>
            ),
          },
          {
            id: "charts",
            node: (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="app-card-padded">
                  <p className="text-sm font-black text-foreground">曜日別の発言数</p>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dowData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="rgba(148,155,166,0.22)" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 12, fill: "#9ca3af" }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "#9ca3af" }}
                          width={48}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(0,0,0,0.04)" }}
                          contentStyle={{
                            borderRadius: 12,
                            border: "1px solid rgba(148,155,166,0.35)",
                            fontSize: 12,
                            fontWeight: 700,
                            background: "var(--app-canvas)",
                            color: "var(--app-sidebar-text-strong)",
                          }}
                          formatter={(value) => [`${Number(value).toLocaleString("ja-JP")}件`, ""]}
                        />
                        <Bar dataKey="発言数" fill="#3964fe" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="app-card-padded">
                  <p className="text-sm font-black text-foreground">時間帯別の発言数</p>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hourData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="rgba(148,155,166,0.22)" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          interval={2}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "#9ca3af" }}
                          width={48}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(0,0,0,0.04)" }}
                          contentStyle={{
                            borderRadius: 12,
                            border: "1px solid rgba(148,155,166,0.35)",
                            fontSize: 12,
                            fontWeight: 700,
                            background: "var(--app-canvas)",
                            color: "var(--app-sidebar-text-strong)",
                          }}
                          formatter={(value) => [`${Number(value).toLocaleString("ja-JP")}件`, ""]}
                          labelFormatter={(label) => `${label}時台`}
                        />
                        <Bar dataKey="発言数" fill="#3964fe" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
