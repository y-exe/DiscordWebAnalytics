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
import StatCard from "./StatCard";
import RankTopCard from "./RankTopCard";
import HeatmapGrid from "./HeatmapGrid";
import { UserAvatar } from "./discord/DiscordIdentity";
import { fetchAPI } from "@/lib/api";
import { formatDiscordDate } from "@/lib/discord-assets";
import { periodLabel } from "@/lib/period";

interface InsightsMember {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  avatar_decoration: string | null;
  count: number;
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

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

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
      data ? data.daily.map((point) => ({ label: shortDate(point.date), 発言数: point.count })) : [],
    [data],
  );

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

  const statsCards = useMemo<
    Array<{ title: string; value: string | number; unit?: string }> | null
  >(() => {
    if (!data || data.messages === 0) return null;
    const avgChars = data.messages > 0 ? Math.round(data.chars / data.messages) : null;
    const activeDays = data.daily.length;
    const maxDaily = data.daily.reduce((max, point) => Math.max(max, point.count), 0);
    return [
      {
        title: "発言数",
        value: data.messages,
        unit: "件",
      },
      {
        title: "総文字数",
        value: data.chars,
        unit: "字",
      },
      {
        title: "平均文字数/発言",
        value: avgChars ?? "—",
        unit: "字",
      },
      {
        title: "参加メンバー",
        value: data.users,
        unit: "人",
      },
      {
        title: "チャンネルランク",
        value: data.rank ? `${data.rank}位` : "—",
      },
      {
        title: "1日の最多発言",
        value: maxDaily,
        unit: "件",
      },
      {
        title: "発言のあった日数",
        value: activeDays,
        unit: "日",
      },
      {
        title: "最初の発言",
        value: data.first_at ? formatDiscordDate(data.first_at) : "—",
      },
    ];
  }, [data]);

  if (failed) {
    return (
      <div className="app-card-padded text-center text-sm text-muted-foreground">
        データの読み込みに失敗しました。
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
  const memberMax = data.members[0]?.count ?? 1;

  return (
    <div className="space-y-5">
      <PageToolbar
        title={`#${channel.name}`}
        subtitle={`${title}のチャンネル統計`}
        right={<PeriodPicker period={period} mode="query" />}
      />

      <div className="flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
        {channel.category && (
          <span className="rounded-full bg-muted px-2.5 py-0.5">{channel.category}</span>
        )}
        {data.rank && (
          <span className="rounded-full bg-muted px-2.5 py-0.5">
            全チャンネル中 {data.rank}位
          </span>
        )}
        <span className="rounded-full bg-muted px-2.5 py-0.5">
          最初 {data.first_at ? formatDiscordDate(data.first_at) : "—"}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-0.5">
          最後 {data.last_at ? formatDiscordDate(data.last_at) : "—"}
        </span>
      </div>

      {statsCards && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statsCards.map((card) => (
            <StatCard
              key={card.title}
              title={card.title}
              value={card.value}
              unit={card.unit}
            />
          ))}
        </div>
      )}

      <div className="app-card-padded">
        <p className="text-sm font-black text-foreground">日別の発言数推移</p>
        <p className="mt-0.5 mb-4 text-xs font-bold text-muted-foreground">{title}の毎日の発言数</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,155,166,0.22)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "#979da6" }}
                minTickGap={28}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "#979da6" }}
                width={40}
              />
              <Tooltip
                contentStyle={sharedTooltipStyle()}
                formatter={(value) => [`${Number(value).toLocaleString("ja-JP")}件`, ""]}
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

      <div className="app-card-padded">
        <p className="text-sm font-black text-foreground">時間帯別アクティビティ</p>
        <p className="mt-0.5 text-xs font-bold text-muted-foreground">
          曜日 × 時間帯の発言集中度
        </p>
        <div className="mt-4">
          <HeatmapGrid data={data.heatmap} />
        </div>
      </div>

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
                  width={40}
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
                  width={40}
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="app-card-padded">
          <p className="text-sm font-black text-foreground">よく発言するメンバー</p>
          <p className="mt-0.5 mb-4 text-xs font-bold text-muted-foreground">
            発言数の多いメンバー トップ10
          </p>
          <ul className="space-y-2.5">
            {data.members.map((member) => (
              <li key={member.user_id}>
                <Link href={`/members/${member.user_id}?m=${period.key}`} className="group block">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs font-bold">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <UserAvatar user={member} size={20} />
                      <span className="truncate text-foreground group-hover:underline">
                        {member.display_name}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {member.count.toLocaleString("ja-JP")}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-accent-data"
                      style={{
                        width: `${Math.max(4, Math.round((member.count / memberMax) * 100))}%`,
                      }}
                    />
                  </div>
                </Link>
              </li>
            ))}
            {data.members.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">データがありません</p>
            )}
          </ul>
        </div>

        <div className="md:col-span-2">
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
      </div>
    </div>
  );
}
