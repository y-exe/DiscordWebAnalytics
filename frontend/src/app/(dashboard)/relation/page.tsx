import type { Metadata } from "next";
import RelationGraphView from "@/components/views/RelationGraphView";
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
  const title = `共通のかかわり (${periodLabel(period)})`;
  const description = `${subject}のメンバー間の結び付きをグラフで可視化 (${periodLabel(period)})。`;
  return socialMetadata({
    title,
    description,
    url: `${baseUrl ?? "https://ymkw.top"}/relation`,
    imageUrl: guild.iconUrl,
  });
}

export default async function RelationPage({ searchParams }: PageProps) {
  const { m } = await searchParams;
  const period = parsePeriod(m);
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const base = baseUrl ?? "https://ymkw.top";
  const subject = guild.name || "Discordサーバー";
  const url = `${base}/relation`;
  const label = periodLabel(period);
  const embed = buildComponentEmbed({
    title: `共通のかかわり (${label})`,
    url,
    description: `${subject}のメンバー間の結び付きをインタラクティブなグラフで閲覧できます。`,
    thumbnailUrl: guild.iconUrl,
    buttons: [
      { label: "メンバー", url: `${base}/members` },
      { label: "チャンネル", url: `${base}/channels` },
      { label: "比較", url: `${base}/compare` },
    ],
    footer: `${subject} ・ ${label}`,
  });
  return (
    <>
      <DiscordComponentEmbedScript payload={embed} />
      <RelationGraphView period={period} />
    </>
  );
}
