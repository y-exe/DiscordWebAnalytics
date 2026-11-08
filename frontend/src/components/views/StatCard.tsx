"use client";

import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import DeltaBadge from "./DeltaBadge";

export interface MiniSeriesPoint {
  label: string;
  value: number;
  compare?: number | null;
}

export default function StatCard({
  title,
  value,
  unit,
  delta,
  series,
  compareSeriesLabel,
  footer,
  chartType = "area",
  formatValue = (v: number) => v.toLocaleString("ja-JP"),
}: {
  title: string;
  value: string | number;
  unit?: string;
  /** 前期間比 (小数)。nullなら非表示 */
  delta?: number | null;
  /** ミニグラフ用データ */
  series?: MiniSeriesPoint[];
  compareSeriesLabel?: string;
  footer?: ReactNode;
  chartType?: "area" | "bar";
  formatValue?: (value: number) => string;
}) {
  const hasCompare = series?.some((point) => point.compare !== undefined && point.compare !== null);
  return (
    <div className="app-card-padded flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-black text-foreground">{title}</p>
        {delta !== undefined && <DeltaBadge delta={delta ?? null} />}
      </div>
      <p className="text-3xl font-black tracking-tight text-foreground">
        {typeof value === "number" ? formatValue(value) : value}
        {unit && <span className="ml-1.5 text-sm font-bold text-muted-foreground">{unit}</span>}
      </p>
      {series && series.length > 0 && (
        <div className="-mx-2 -mb-1 mt-auto h-24">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "bar" ? (
              <BarChart data={series} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  interval="preserveStartEnd"
                  minTickGap={24}
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
                  formatter={(value) => [formatValue(Number(value)), ""]}
                  labelFormatter={(label) => String(label)}
                />
                {hasCompare && (
                  <Bar
                    dataKey="compare"
                    fill="rgba(148,155,166,0.35)"
                    radius={[3, 3, 0, 0]}
                    name={compareSeriesLabel ?? "前期間"}
                  />
                )}
                <Bar dataKey="value" fill="#3964fe" radius={[3, 3, 0, 0]} name={title} />
              </BarChart>
            ) : (
              <AreaChart data={series} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                <defs>
                  <linearGradient
                    id={`stat-${title.replaceAll("/", "-")}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#3964fe" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#3964fe" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "#9ca3af" }}
                  interval="preserveStartEnd"
                  minTickGap={24}
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
                  formatter={(value) => [formatValue(Number(value)), ""]}
                  labelFormatter={(label) => String(label)}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#3964fe"
                  strokeWidth={2}
                  fill={`url(#stat-${title.replaceAll("/", "-")})`}
                  name={title}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      {footer}
    </div>
  );
}
