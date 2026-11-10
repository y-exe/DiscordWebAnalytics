import type { Metadata } from "next";
import ChannelsView from "@/components/views/ChannelsView";
import {
  DiscordComponentEmbedScript,
  buildComponentEmbed,
  socialMetadata,
} from "@/lib/discord-embed";
import { getGuildBaseUrl, getGuildContext } from "@/lib/guild-context";
import { parsePeriod, periodLabel } from "@/lib/period";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ m?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { m } = await searchParams;
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const period = parsePeriod(m);
  const subject = guild.name || "Discordサーバー";
  const title = `チャンネル (${periodLabel(period)})`;
  const description = `${subject}のチャンネル別アクティビティ (${periodLabel(period)})。`;
  return socialMetadata({
    title,
    description,
    url: `${baseUrl ?? "https://ymkw.top"}/channels`,
    imageUrl: guild.iconUrl,
  });
}

export default async function ChannelsPage({ searchParams }: PageProps) {
  const { m } = await searchParams;
  const period = parsePeriod(m);
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const base = baseUrl ?? "https://ymkw.top";
  const subject = guild.name || "Discordサーバー";
  const url = `${base}/channels`;
  const label = periodLabel(period);
  const embed = buildComponentEmbed({
    title: `チャンネル (${label})`,
    url,
    description: `${subject}のチャンネル別アクティビティを閲覧できます。`,
    thumbnailUrl: guild.iconUrl,
    buttons: [
      { label: "メンバー", url: `${base}/members` },
      { label: "共通のかかわり", url: `${base}/relation` },
      { label: "比較", url: `${base}/compare` },
    ],
    footer: `${subject} ・ ${label}`,
  });
  return (
    <>
      <DiscordComponentEmbedScript payload={embed} />
      <ChannelsView period={period} />
    </>
  );
}
