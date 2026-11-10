import type { Metadata } from "next";
import MemberDetailView from "@/components/views/MemberDetailView";
import {
  DiscordComponentEmbedScript,
  buildComponentEmbed,
  socialMetadata,
} from "@/lib/discord-embed";
import { fetchAPI } from "@/lib/api";
import { getGuildBaseUrl, getGuildContext } from "@/lib/guild-context";
import { parsePeriod, periodLabel } from "@/lib/period";
import { formatNumber } from "@/lib/seo";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ userId: string }>; searchParams: Promise<{ m?: string }> };

interface MemberInsights {
  user: {
    display_name: string;
    username: string;
    avatar: string | null;
    avatar_fallback: string | null;
    primary_guild_tag: string | null;
    joined_at: string | null;
  } | null;
  messages: number;
  rank: number | null;
}

async function fetchMemberInsights(userId: string, m?: string): Promise<MemberInsights | null> {
  const period = parsePeriod(m);
  const path = period.isAll
    ? `/users/${userId}/insights/total`
    : `/users/${userId}/insights/${period.year}/${period.month}`;
  try {
    const res = await fetchAPI(path, { retries: 0 });
    if (!res.ok) return null;
    return (await res.json()) as MemberInsights;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { userId } = await params;
  const { m } = await searchParams;
  const [guild, baseUrl, insights] = await Promise.all([
    getGuildContext(),
    getGuildBaseUrl(),
    fetchMemberInsights(userId, m),
  ]);
  const subject = guild.name || "Discordサーバー";
  const name = insights?.user?.display_name;
  const title = name ? `${name} のメンバー詳細` : `メンバー詳細 (${userId})`;
  const parts = [`${subject}のメンバーの活動データ。`];
  if (insights) {
    parts.unshift(
      `発言数 ${formatNumber(insights.messages)}件` +
        (insights.rank ? ` ・ ランク ${insights.rank}位` : ""),
    );
  }
  const avatar = insights?.user?.avatar ?? insights?.user?.avatar_fallback ?? null;
  return socialMetadata({
    title,
    description: parts.join(" "),
    url: `${baseUrl ?? "https://ymkw.top"}/members/${userId}`,
    imageUrl: avatar,
  });
}

export default async function MemberDetailPage({ params, searchParams }: PageProps) {
  const { userId } = await params;
  const { m } = await searchParams;
  if (!/^\d+$/.test(userId)) return null;
  const period = parsePeriod(m);
  const [guild, baseUrl, insights] = await Promise.all([
    getGuildContext(),
    getGuildBaseUrl(),
    fetchMemberInsights(userId, m),
  ]);
  const base = baseUrl ?? "https://ymkw.top";
  const subject = guild.name || "Discordサーバー";
  const name = insights?.user?.display_name ?? "メンバー";
  const avatar = insights?.user?.avatar ?? insights?.user?.avatar_fallback ?? null;
  const label = periodLabel(period);
  const stats = insights
    ? `発言数 ${formatNumber(insights.messages)}件` +
      (insights.rank ? ` ・ 総合ランク ${insights.rank}位` : "")
    : "活動データを閲覧できます。";
  const embed = buildComponentEmbed({
    title: `${name} (${label})`,
    url: `${base}/members/${userId}`,
    description: `${subject}での活動データ。\n${stats}`,
    thumbnailUrl: avatar,
    buttons: [{ label: "メンバー一覧", url: `${base}/members` }],
    footer: `${subject} ・ ${label}`,
  });
  return (
    <>
      <DiscordComponentEmbedScript payload={embed} />
      <MemberDetailView userId={userId} period={period} />
    </>
  );
}
