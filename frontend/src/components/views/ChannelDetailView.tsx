"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Hash, MessageSquare } from "lucide-react";
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
  first_at: string | null;
  last_at: string | null;
}

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function shortDate(date: string): string {
  const parts = date.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function KpiChip({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="app-card-padded min-w-36 flex-1 py-4">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-black tracking-tight text-foreground">
        {value}
        {unit && <span className="ml-1 text-xs font-bold text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold text-foreground">{value}</span>
    </div>
  );
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
        <div className="h-16 w-72 animate-pulse rounded-xl bg-muted" />
        <div className="h-52 animate-pulse rounded-2xl bg-muted" />
        <div className="flex gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-20 flex-1 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
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
          <ArrowLeft className="h-4 w-4" />
          チャンネル一覧へ戻る
        </Link>
        <div className="app-card-padded text-center text-sm text-muted-foreground">
          この期間に発言記録のないチャンネルです。
        </div>
      </div>
    );
  }

  const channel = data.channel;
  const memberMax = data.members[0]?.count ?? 1;

  return (
    <div className="space-y-5">
      <Link
        href={`/channels?m=${period.key}`}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        チャンネル一覧へ戻る
      </Link>

      <PageToolbar
        title={title}
        subtitle="チャンネルの様子をより詳しく把握しましょう！"
        right={<PeriodPicker period={period} mode="query" />}
      />

      {/* チャンネルヘッダー */}
      <div className="app-card overflow-hidden">
        <div className="h-24 w-full bg-gradient-to-br from-[#3964fe33] to-[#3964fe66] md:h-28" />
        <div className="px-5 pb-5 md:px-6">
          <div className="-mt-9 mb-3 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl border-4 border-card bg-muted">
            <Hash className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black tracking-tight text-foreground md:text-2xl">
              #{channel.name}
            </h2>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
              {channel.category}
            </span>
          </div>
          <div className="mt-4 grid gap-x-6 gap-y-1.5 border-t border-border pt-4 text-sm md:grid-cols-2">
            <MetaRow
              icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
              label="最初の発言"
              value={formatDiscordDate(data.first_at)}
            />
            <MetaRow
              icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
              label="最後の発言"
              value={formatDiscordDate(data.last_at)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <KpiChip label="発言数" value={data.messages.toLocaleString("ja-JP")} unit="件" />
        <KpiChip label="総文字数" value={data.chars.toLocaleString("ja-JP")} unit="字" />
        <KpiChip
          label="平均文字数/発言"
          value={data.messages > 0 ? String(Math.round(data.chars / data.messages)) : "—"}
          unit="字"
        />
        <KpiChip label="参加メンバー" value={data.users.toLocaleString("ja-JP")} unit="人" />
      </div>

      <div className="app-card-padded">
        <p className="text-sm font-black text-foreground">日別の発言数推移</p>
        <p className="mt-0.5 mb-4 text-xs font-bold text-muted-foreground">{title}の毎日の発言数</p>
        <div className="h-64">
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

      <div className="grid gap-4 lg:grid-cols-2">
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

        <div className="space-y-4">
          <div className="app-card-padded">
            <p className="text-sm font-black text-foreground">曜日別の発言数</p>
            <div className="mt-3 h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dowData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "#979da6" }}
                  />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: "rgba(127,127,127,0.08)" }}
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
                  <Bar dataKey="発言数" fill="#3964fe" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="app-card-padded">
            <p className="text-sm font-black text-foreground">時間帯別の発言数</p>
            <div className="mt-3 h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "#979da6" }}
                    interval={2}
                  />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: "rgba(127,127,127,0.08)" }}
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
                  <Bar dataKey="発言数" fill="#3964fe" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
