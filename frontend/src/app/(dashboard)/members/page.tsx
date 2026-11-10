import type { Metadata } from "next";
import MembersView from "@/components/views/MembersView";
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
  const title = `メンバー (${periodLabel(period)})`;
  const description = `${subject}のメンバー別アクティビティ (${periodLabel(period)})。`;
  return socialMetadata({
    title,
    description,
    url: `${baseUrl ?? "https://ymkw.top"}/members`,
    imageUrl: guild.iconUrl,
  });
}

export default async function MembersPage({ searchParams }: PageProps) {
  const { m } = await searchParams;
  const period = parsePeriod(m);
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const base = baseUrl ?? "https://ymkw.top";
  const subject = guild.name || "Discordサーバー";
  const url = `${base}/members`;
  const label = periodLabel(period);
  const embed = buildComponentEmbed({
    title: `メンバー (${label})`,
    url,
    description: `${subject}のメンバー別ランキングと活動データを閲覧できます。`,
    thumbnailUrl: guild.iconUrl,
    buttons: [
      { label: "チャンネル", url: `${base}/channels` },
      { label: "共通のかかわり", url: `${base}/relation` },
      { label: "比較", url: `${base}/compare` },
    ],
    footer: `${subject} ・ ${label}`,
  });
  return (
    <>
      <DiscordComponentEmbedScript payload={embed} />
      <MembersView period={period} />
    </>
  );
}
