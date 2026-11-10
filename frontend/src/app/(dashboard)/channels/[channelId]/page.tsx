import type { Metadata } from "next";
import ChannelDetailView from "@/components/views/ChannelDetailView";
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

type PageProps = { params: Promise<{ channelId: string }>; searchParams: Promise<{ m?: string }> };

interface ChannelInsights {
  channel: { name: string } | null;
  messages: number;
}

async function fetchChannelInsights(
  channelId: string,
  m?: string,
): Promise<ChannelInsights | null> {
  const period = parsePeriod(m);
  const path = period.isAll
    ? `/channels/${channelId}/insights/total`
    : `/channels/${channelId}/insights/${period.year}/${period.month}`;
  try {
    const res = await fetchAPI(path, { retries: 0 });
    if (!res.ok) return null;
    return (await res.json()) as ChannelInsights;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { channelId } = await params;
  const { m } = await searchParams;
  const [guild, baseUrl, insights] = await Promise.all([
    getGuildContext(),
    getGuildBaseUrl(),
    /^\d+$/.test(channelId) ? fetchChannelInsights(channelId, m) : Promise.resolve(null),
  ]);
  const subject = guild.name || "Discordサーバー";
  const name = insights?.channel?.name;
  const title = name ? `#${name} のチャンネル詳細` : `チャンネル詳細 (${channelId})`;
  const description = insights
    ? `${subject}のチャンネルの活動データ。発言数 ${formatNumber(insights.messages)}件。`
    : `${subject}のチャンネル (ID: ${channelId}) の活動データ。`;
  return socialMetadata({
    title,
    description,
    url: `${baseUrl ?? "https://ymkw.top"}/channels/${channelId}`,
    imageUrl: guild.iconUrl,
  });
}

export default async function ChannelDetailPage({ params, searchParams }: PageProps) {
  const { channelId } = await params;
  const { m } = await searchParams;
  if (!/^\d+$/.test(channelId)) return null;
  const period = parsePeriod(m);
  const [guild, baseUrl, insights] = await Promise.all([
    getGuildContext(),
    getGuildBaseUrl(),
    fetchChannelInsights(channelId, m),
  ]);
  const base = baseUrl ?? "https://ymkw.top";
  const subject = guild.name || "Discordサーバー";
  const name = insights?.channel?.name ?? "チャンネル";
  const label = periodLabel(period);
  const stats = insights
    ? `発言数 ${formatNumber(insights.messages)}件`
    : "活動データを閲覧できます。";
  const embed = buildComponentEmbed({
    title: `#${name} (${label})`,
    url: `${base}/channels/${channelId}`,
    description: `${subject}のチャンネルの活動データ。\n${stats}`,
    thumbnailUrl: guild.iconUrl,
    buttons: [{ label: "チャンネル一覧", url: `${base}/channels` }],
    footer: `${subject} ・ ${label}`,
  });
  return (
    <>
      <DiscordComponentEmbedScript payload={embed} />
      <ChannelDetailView channelId={channelId} period={period} />
    </>
  );
}
