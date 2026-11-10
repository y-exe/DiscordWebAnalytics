"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageToolbar from "@/components/shell/PageToolbar";
import PeriodPicker from "@/components/shell/PeriodPicker";
import Reorderable from "./Reorderable";
import StatCard from "./StatCard";
import RankTopCard from "./RankTopCard";
import HeatmapGrid from "./HeatmapGrid";
import { fetchAPI } from "@/lib/api";
import { periodLabel } from "@/lib/period";

interface InsightsMember {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  avatar_decoration: string | null;
  count: number;
  /** 文字数王カード用 (backendの新API以降で返る。旧キャッシュでは欠落) */
  chars?: number;
}

interface Insights {
  channel: { channel_id: string; name: string; category: string; position: number } | null;
  messages: number;
  chars: number;
  users: number;
  rank: number | null;
  daily: Array<{ date: string; count: number }>;
  members: InsightsMember[];
  dow: Array<{ dow: number; count: number }>;
  hours: Array<{ hour: number; count: number }>;
  heatmap: Array<{ dow: number; hour: number; count: number }>;
  top_dates: Array<{ date: string; count: number }>;
  first_at: string | null;
  last_at: string | null;
}

function shortDate(date: string): string {
  const parts = date.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function sharedTooltipStyle(): React.CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid rgba(148,155,166,0.35)",
    fontSize: 12,
    fontWeight: 700,
    background: "var(--app-canvas)",
    color: "var(--app-sidebar-text-strong)",
  };
}

export default function ChannelDetailView({
  channelId,
  period,
}: {
  channelId: string;
  period: { key: string; year: number | null; month: number | null; isAll: boolean };
}) {
  const [data, setData] = useState<Insights | null>(null);
  const [failed, setFailed] = useState(false);

  const base = period.isAll
    ? `/channels/${channelId}/insights/total`
    : `/channels/${channelId}/insights/${period.year}/${period.month}`;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    fetchAPI(base, { retries: 1 })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Insights;
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base, channelId]);

  const title = period.isAll ? "全期間" : periodLabel(period);

  const chartData = useMemo(
    () =>
      data
        ? data.daily.map((point) => ({ label: shortDate(point.date), 発言数: point.count }))
        : [],
    [data],
  );

  const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

  const dowData = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.dow.map((d) => [d.dow, d.count]));
    return DOW_LABELS.map((label, dow) => ({ label, 発言数: map.get(dow) ?? 0 }));
  }, [data]);

  const hourData = useMemo(() => {
    if (!data) return [];
    const map = new Map(data.hours.map((h) => [h.hour, h.count]));
    return Array.from({ length: 24 }, (_, hour) => ({
      label: String(hour),
      発言数: map.get(hour) ?? 0,
    }));
  }, [data]);

  const daysInPeriod = useMemo(() => {
    if (!period.year || !period.month) return null;
    if (period.isAll) {
      const daily = data?.daily ?? [];
      if (daily.length === 0) return null;
      const dates = daily.map((point) => new Date(point.date).getTime());
      const days = Math.round((Math.max(...dates) - Math.min(...dates)) / 86400000) + 1;
      return days > 0 ? days : null;
    }
    return new Date(period.year, period.month, 0).getDate();
  }, [period, data]);

  const peakHour = useMemo<{ hour: number; count: number } | null>(() => {
    if (!data) return null;
    return data.hours.reduce(
      (best, cur) => (best === null || cur.count > best.count ? cur : best),
      null as { hour: number; count: number } | null,
    );
  }, [data]);

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

  if (!data.channel || data.messages === 0) {
    return (
      <div className="space-y-4">
        <Link
          href={`/channels?m=${period.key}`}
          className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground"
        >
          チャンネル一覧へ戻る
        </Link>
        <div className="app-card-padded text-center text-sm text-muted-foreground">
          {data.channel
            ? `#${data.channel.name} はこの期間に発言記録のないチャンネルです。`
            : "この期間に発言記録のないチャンネルです。"}
        </div>
      </div>
    );
  }

  const channel = data.channel;
  const total = data.messages;
  const avgPerDay = daysInPeriod && total > 0 ? total / daysInPeriod : null;
  const avgChars = total > 0 ? Math.round(data.chars / total) : null;
  const activeDays = data.daily.length;

  return (
    <div className="space-y-5">
      <PageToolbar
        title={`#${channel.name}`}
        subtitle={`${title}のチャンネル統計`}
        right={<PeriodPicker period={period} mode="query" />}
      />

      <Reorderable
        storageKey={period.isAll ? "layout.channel.all" : "layout.channel.month"}
        items={[
          {
            id: "kpis",
            node: (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="総発言数"
                  value={total}
                  unit="件"
                  series={data.daily.map((p) => ({ label: shortDate(p.date), value: p.count }))}
                />
                <StatCard title="アクティブメンバー" value={data.users} unit="人" />
                <StatCard title="総文字数" value={data.chars} unit="字" />
                <StatCard
                  title="1日平均発言数"
                  value={avgPerDay === null ? "—" : Math.round(avgPerDay * 10) / 10}
                  unit="件"
                  chartType="bar"
                  series={data.daily
                    .slice(-14)
                    .map((p) => ({ label: shortDate(p.date), value: p.count }))}
                />
              </div>
            ),
          },
          {
            id: "extra-kpis",
            node: (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  title="平均文字数/発言"
                  value={avgChars ?? "—"}
                  unit={avgChars === null ? undefined : "字"}
                />
                <StatCard
                  title="ピーク時間帯"
                  value={peakHour ? `${peakHour.hour}:00台` : "—"}
                  unit={peakHour ? `${peakHour.count.toLocaleString("ja-JP")}件` : undefined}
                />
                <StatCard title="チャンネルランク" value={data.rank ? `${data.rank}位` : "—"} />
                <StatCard
                  title="発言のあった日数"
                  value={activeDays > 0 ? activeDays : "—"}
                  unit={activeDays > 0 ? "日" : undefined}
                />
              </div>
            ),
          },
          {
            id: "activity",
            node: (
              <div className="app-card-padded">
                <p className="text-sm font-black text-foreground">時間帯別アクティビティ</p>
                <p className="mt-0.5 text-xs font-bold text-muted-foreground">
                  曜日 × 時間帯の発言集中度
                </p>
                <div className="mt-4">
                  <HeatmapGrid data={data.heatmap} />
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
                  note="このチャンネルで最も発言したメンバー"
                  unit="件"
                  items={data.members.map((u) => ({
                    user_id: u.user_id,
                    display_name: u.display_name,
                    avatar: u.avatar,
                    avatar_decoration: u.avatar_decoration,
                    count: u.count,
                  }))}
                  hrefBase="/members/"
                />
                {/* 文字数は旧APIレスポンスに含まれないため、データがある場合のみ表示する */}
                {typeof data.members[0]?.chars === "number" && (
                  <RankTopCard
                    title="文字数王"
                    note="このチャンネルで最も多く文字を書いたメンバー"
                    unit="字"
                    items={[...data.members]
                      .sort((a, b) => (b.chars ?? 0) - (a.chars ?? 0))
                      .map((u) => ({
                        user_id: u.user_id,
                        display_name: u.display_name,
                        avatar: u.avatar,
                        avatar_decoration: u.avatar_decoration,
                        count: u.chars ?? 0,
                      }))}
                    hrefBase="/members/"
                  />
                )}
                <RankTopCard
                  title="最多発言日"
                  note="このチャンネルで最も盛り上がった日 トップ5"
                  unit="件"
                  emptyText="データがありません"
                  items={data.top_dates.map((entry) => ({
                    user_id: `date-${entry.date}`,
                    display_name: entry.date.replaceAll("-", "/"),
                    count: entry.count,
                  }))}
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
                        contentStyle={sharedTooltipStyle()}
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
            id: "distribution",
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
                          tick={{ fontSize: 12, fill: "#979da6" }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "#979da6" }}
                          width={48}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(127,127,127,0.08)" }}
                          contentStyle={sharedTooltipStyle()}
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
                          tick={{ fontSize: 10, fill: "#979da6" }}
                          interval={2}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "#979da6" }}
                          width={48}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(127,127,127,0.08)" }}
                          contentStyle={sharedTooltipStyle()}
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
