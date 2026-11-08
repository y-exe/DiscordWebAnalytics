"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, MessageSquare, Sparkles } from "lucide-react";
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
import { BoostBadge, BoostIcon, ServerTagChip, UserAvatar } from "./discord/DiscordIdentity";
import StatCard from "./StatCard";
import { fetchAPI } from "@/lib/api";
import { formatDiscordDate, snowflakeToDate } from "@/lib/discord-assets";
import { periodLabel } from "@/lib/period";

interface InsightsUser {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  banner: string | null;
  accent_color: string | null;
  avatar_decoration: string | null;
  nameplate: { asset: string; palette: string } | null;
  primary_guild_tag: string | null;
  primary_guild_badge: string | null;
  joined_at: string | null;
  premium_since: string | null;
}

interface Insights {
  user: InsightsUser | null;
  messages: number;
  chars: number;
  rank: number | null;
  daily: Array<{ date: string; count: number; chars?: number }>;
  channels: Array<{ channel_id: string; name: string; count: number }>;
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

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold text-foreground">{value}</span>
    </div>
  );
}

export default function MemberDetailView({
  userId,
  period,
}: {
  userId: string;
  period: { key: string; year: number | null; month: number | null; isAll: boolean };
}) {
  const [data, setData] = useState<Insights | null>(null);
  const [failed, setFailed] = useState(false);

  const base = period.isAll
    ? `/users/${userId}/insights/total`
    : `/users/${userId}/insights/${period.year}/${period.month}`;

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
  }, [base, userId]);

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

  const accountCreatedAt = useMemo(() => snowflakeToDate(userId), [userId]);

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

  if (!data.user || data.messages === 0) {
    return (
      <div className="space-y-4">
        <Link
          href={`/members?m=${period.key}`}
          className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          メンバー一覧へ戻る
        </Link>
        <div className="app-card-padded text-center text-sm text-muted-foreground">
          この期間に発言記録のないメンバーです。
        </div>
      </div>
    );
  }

  const user = data.user;
  const activeDays = data.daily.filter((p) => p.count > 0).length;
  const channelMax = data.channels[0]?.count ?? 1;

  return (
    <div className="space-y-5">
      <Link
        href={`/members?m=${period.key}`}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        メンバー一覧へ戻る
      </Link>

      <PageToolbar
        title={title}
        subtitle="メンバーの行動や好みをより詳しく把握しましょう！"
        right={<PeriodPicker period={period} mode="query" />}
      />

      {/* プロフィール (左) とKPI (右) を別カードで左右に配置 */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <div className="app-card overflow-hidden">
          <div
            className="h-32 w-full md:h-40"
            style={
              user.banner
                ? {
                    backgroundImage: `url(${user.banner})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : {
                    background: user.accent_color
                      ? `linear-gradient(135deg, ${user.accent_color}, ${user.accent_color}cc)`
                      : "linear-gradient(135deg, #3964fe33, #3964fe66)",
                  }
            }
          />
          <div className="px-5 pb-5 md:px-6">
            <div>
              <div className="-mt-10 mb-3">
                <UserAvatar user={user} size={80} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black tracking-tight text-foreground md:text-2xl">
                  {user.display_name}
                </h2>
                <ServerTagChip tag={user.primary_guild_tag} badge={user.primary_guild_badge} />
                {user.premium_since && <BoostBadge />}
              </div>
              <p className="text-sm font-bold text-muted-foreground">@{user.username}</p>
              <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
                <MetaRow
                  icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
                  label="サーバーに参加した日"
                  value={formatDiscordDate(user.joined_at)}
                />
                <MetaRow
                  icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
                  label="Discordアカウント作成日"
                  value={formatDiscordDate(accountCreatedAt?.toISOString() ?? null)}
                />
                {user.premium_since && (
                  <MetaRow
                    icon={<BoostIcon className="h-4 w-4" />}
                    label="ブースト開始日"
                    value={formatDiscordDate(user.premium_since)}
                  />
                )}
                <MetaRow
                  icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
                  label="最初の発言"
                  value={formatDiscordDate(data.first_at)}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="grid auto-rows-fr grid-cols-2 gap-4">
          <StatCard
            title="発言数"
            value={data.messages}
            unit="件"
            series={data.daily.map((p) => ({ label: shortDate(p.date), value: p.count }))}
          />
          <StatCard
            title="総文字数"
            value={data.chars}
            unit="字"
            series={data.daily.map((p) => ({ label: shortDate(p.date), value: p.chars ?? 0 }))}
          />
          <StatCard
            title="平均文字数/発言"
            value={data.messages > 0 ? Math.round(data.chars / data.messages) : "—"}
            unit="字"
            series={data.daily.map((p) => ({
              label: shortDate(p.date),
              value: p.count > 0 ? Math.round((p.chars ?? 0) / p.count) : 0,
            }))}
          />
          <StatCard
            title="アクティブ日数"
            value={activeDays}
            unit="日"
            chartType="bar"
            series={data.daily.map((p) => ({ label: shortDate(p.date), value: p.count }))}
          />
        </div>
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
          <p className="text-sm font-black text-foreground">よく発言するチャンネル</p>
          <p className="mt-0.5 mb-4 text-xs font-bold text-muted-foreground">
            発言数の多いチャンネル トップ10
          </p>
          <ul className="space-y-2.5">
            {data.channels.map((channel) => (
              <li key={channel.channel_id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs font-bold">
                  <span className="truncate text-foreground">#{channel.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {channel.count.toLocaleString("ja-JP")}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent-data"
                    style={{
                      width: `${Math.max(4, Math.round((channel.count / channelMax) * 100))}%`,
                    }}
                  />
                </div>
              </li>
            ))}
            {data.channels.length === 0 && (
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
