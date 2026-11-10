"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import PageToolbar from "@/components/shell/PageToolbar";
import PeriodPicker from "@/components/shell/PeriodPicker";
import DeltaBadge, { deltaRate } from "./DeltaBadge";
import { fetchAPI } from "@/lib/api";
import { periodLabel } from "@/lib/period";

interface ChannelStat {
  channel_id: string;
  name: string;
  category: string;
  messages: number;
  users: number;
  chars: number;
  prev: { messages: number; users: number; chars: number } | null;
}

export default function ChannelsView({
  period,
}: {
  period: { key: string; year: number | null; month: number | null; isAll: boolean };
}) {
  const [data, setData] = useState<ChannelStat[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const base = period.isAll
    ? "/channels/stats/total"
    : `/channels/stats/${period.year}/${period.month}`;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    fetchAPI(base, { retries: 1 })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as ChannelStat[];
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const categories = useMemo(() => {
    if (!data) return [];
    const set = new Map<string, number>();
    for (const row of data) set.set(row.category, (set.get(row.category) ?? 0) + row.messages);
    return [...set.entries()]
      .filter(([name]) => name !== "未分類")
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter(
      (row) =>
        (!category || row.category === category) &&
        (!query.trim() || row.name.toLowerCase().includes(query.trim().toLowerCase())),
    );
  }, [data, query, category]);

  const title = period.isAll ? "全期間" : periodLabel(period);

  return (
    <div>
      <PageToolbar
        title="チャンネル"
        subtitle="メンバーに愛されているチャンネルを確認しましょう"
        right={<PeriodPicker period={period} />}
      />

      <div className="app-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-black text-foreground">チャンネルごとのデータ一覧</p>
            <p className="mt-0.5 text-xs font-bold text-muted-foreground">
              {title}の発言数・参加メンバー・文字数と前期間との比較
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="チャンネルを検索..."
                className="h-8 w-48 rounded-lg border border-input bg-muted pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>

        {failed ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            データの読み込みに失敗しました。
          </p>
        ) : !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : (
          <>
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setCategory(null)}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${!category ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  すべて
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(category === cat ? null : cat)}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${category === cat ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-bold text-muted-foreground">
                    <th className="px-4 py-3">チャンネル名</th>
                    <th className="px-4 py-3">発言数</th>
                    <th className="px-4 py-3">参加メンバー</th>
                    <th className="px-4 py-3">文字数</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const delta = row.prev ? deltaRate(row.messages, row.prev.messages) : null;
                    return (
                      <tr
                        key={row.channel_id}
                        className="border-b border-border/60 transition-colors hover:bg-muted/50"
                      >
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/channels/${row.channel_id}?m=${period.key}`}
                            className="block"
                          >
                            <p className="font-bold text-foreground transition-colors hover:text-[#3964fe] hover:underline">
                              #{row.name}
                            </p>
                            <p className="text-xs text-muted-foreground">{row.category}</p>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5 font-bold text-foreground">
                            {row.messages.toLocaleString("ja-JP")}
                            <DeltaBadge delta={delta} />
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-bold text-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            {row.users.toLocaleString("ja-JP")}
                            {row.prev && (
                              <DeltaBadge delta={deltaRate(row.users, row.prev.users)} />
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-bold text-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            {row.chars.toLocaleString("ja-JP")}
                            {row.prev && (
                              <DeltaBadge delta={deltaRate(row.chars, row.prev.chars)} />
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        該当するチャンネルがありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
