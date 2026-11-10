"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageToolbar from "@/components/shell/PageToolbar";
import PeriodPicker from "@/components/shell/PeriodPicker";
import { ServerTagChip, UserAvatar } from "./discord/DiscordIdentity";
import { fetchAPI } from "@/lib/api";
import { periodLabel } from "@/lib/period";

interface SearchUser {
  user_id: string;
  display_name: string;
  username: string;
  avatar: string | null;
  avatar_decoration?: string | null;
  nameplate?: { asset: string; palette: string } | null;
  primary_guild_tag?: string | null;
  primary_guild_badge?: string | null;
}

interface ChartPoint {
  date: string;
  total: number;
  [userId: string]: unknown;
}

const COLORS = ["#3964fe", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6"];

function shortDate(date: string): string {
  const parts = date.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

/** 選択中メンバーの取得・追加・削除を管理するビュー */
export default function CompareView({
  period,
  initialUserIds,
}: {
  period: { key: string; year: number | null; month: number | null; isAll: boolean };
  initialUserIds: string[];
}) {
  const [selected, setSelected] = useState<SearchUser[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [chart, setChart] = useState<ChartPoint[] | null>(null);

  const basePath = period.isAll
    ? "/stats/history/total"
    : `/stats/history/${period.year}/${period.month}`;

  // URLのuser_idパラメータから初期選択を復元する (rank APIで名前・アバターを取得)
  useEffect(() => {
    const ids = initialUserIds.filter((id) => /^\d+$/.test(id)).slice(0, 5);
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const users = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetchAPI(
              period.isAll
                ? `/users/${id}/rank/total`
                : `/users/${id}/rank/monthly/${period.year}/${period.month}`,
              { retries: 0 },
            );
            if (!res.ok) return null;
            const body = (await res.json()) as {
              user_id?: string;
              display_name?: string;
              avatar?: string | null;
            } | null;
            if (!body?.user_id) return null;
            return {
              user_id: id,
              display_name: body.display_name ?? `ユーザー${id}`,
              username: "",
              avatar: body.avatar ?? null,
            } as SearchUser;
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) setSelected(users.filter((user): user is SearchUser => user !== null));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 選択メンバーの推移を取得
  useEffect(() => {
    if (selected.length === 0) {
      setChart(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    if (!period.isAll) params.set("m", period.key);
    for (const user of selected) params.append("user_id", user.user_id);
    const path = period.isAll
      ? `${basePath}?${selected.map((u) => `user_id=${u.user_id}`).join("&")}`
      : `${basePath}?${selected.map((u) => `user_id=${u.user_id}`).join("&")}`;
    fetchAPI(path, { retries: 1 })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { chart_data: Array<Record<string, unknown>> };
        if (cancelled) return;
        setChart(
          body.chart_data.map((row) => {
            const point: ChartPoint = { date: String(row.date), total: Number(row.total) };
            for (const user of selected) point[user.user_id] = Number(row[user.user_id] ?? 0);
            return point;
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setChart(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, basePath, period]);

  // 検索
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      fetchAPI(`/users/search?q=${encodeURIComponent(q)}`, { retries: 0 })
        .then(async (res) => {
          if (res.ok) setResults((await res.json()) as SearchUser[]);
        })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const add = useCallback((user: SearchUser) => {
    setSelected((prev) =>
      prev.some((entry) => entry.user_id === user.user_id) || prev.length >= 5
        ? prev
        : [...prev, user],
    );
    setQuery("");
    setResults([]);
  }, []);

  const remove = useCallback((userId: string) => {
    setSelected((prev) => prev.filter((entry) => entry.user_id !== userId));
  }, []);

  const title = period.isAll ? "全期間" : periodLabel(period);
  const hasData = chart && chart.length > 0;

  const summary = useMemo(() => {
    if (!chart || selected.length === 0) return [];
    return selected.map((user, index) => ({
      user,
      color: COLORS[index % COLORS.length],
      total: chart.reduce((sum, point) => sum + Number(point[user.user_id] ?? 0), 0),
      activeDays: chart.filter((point) => Number(point[user.user_id] ?? 0) > 0).length,
    }));
  }, [chart, selected]);

  return (
    <div>
      <PageToolbar
        title="比較"
        subtitle="メンバー同士の発言推移を並べて比較しましょう"
        right={<PeriodPicker period={period} />}
      />

      <div className="app-card mb-4 p-4">
        <p className="mb-3 text-sm font-black text-foreground">比較するメンバー (最大5人)</p>
        <div className="flex flex-wrap items-center gap-2">
          {selected.map((user, index) => (
            <span
              key={user.user_id}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2 text-sm font-bold text-foreground"
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: COLORS[index % COLORS.length] }}
              />
              <UserAvatar user={user} size={24} />
              {user.display_name}
              <ServerTagChip tag={user.primary_guild_tag} badge={user.primary_guild_badge} />
              <button
                type="button"
                onClick={() => remove(user.user_id)}
                aria-label={`${user.display_name}を削除`}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            </span>
          ))}
          {selected.length < 5 && (
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="メンバーを検索して追加..."
                className="h-9 w-64 rounded-full border border-input bg-muted px-4 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
              />
              {results.length > 0 && (
                <div className="app-card absolute left-0 top-11 z-20 max-h-72 w-80 overflow-y-auto custom-scrollbar p-1.5 shadow-xl">
                  {results.map((user) => (
                    <button
                      key={user.user_id}
                      type="button"
                      onClick={() => add(user)}
                      className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-muted"
                    >
                      <UserAvatar user={user} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-foreground">
                          {user.display_name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{user.username}
                        </span>
                      </span>
                      <Plus className="ml-auto h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="app-card-padded">
        <p className="text-sm font-black text-foreground">日別の発言数比較</p>
        <p className="mt-0.5 text-xs font-bold text-muted-foreground">
          {title}の每日の発言数を選択メンバー別に表示
        </p>
        <div className="mt-4 h-80">
          {!hasData ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              メンバーを選択すると比較グラフが表示されます
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(148,155,166,0.22)" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  minTickGap={28}
                  tickFormatter={shortDate}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  width={44}
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
                  labelFormatter={(label) => shortDate(String(label))}
                />
                {selected.map((user, index) => (
                  <Line
                    key={user.user_id}
                    type="monotone"
                    dataKey={user.user_id}
                    name={user.display_name}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {summary.length > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {summary.map((entry) => (
            <div key={entry.user.user_id} className="app-card-padded">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <UserAvatar user={entry.user} size={28} />
                <span className="truncate text-sm font-bold text-foreground">
                  {entry.user.display_name}
                </span>
              </div>
              <p className="mt-3 text-2xl font-black tracking-tight text-foreground">
                {entry.total.toLocaleString("ja-JP")}
                <span className="ml-1 text-xs font-bold text-muted-foreground">件</span>
              </p>
              <p className="mt-1 text-xs font-bold text-muted-foreground">
                発言のあった日数: {entry.activeDays}日
              </p>
              <a
                href={`/members/${entry.user.user_id}?m=${period.key}`}
                className="mt-2 inline-block text-xs font-bold text-accent-data hover:underline"
              >
                詳細を見る →
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
