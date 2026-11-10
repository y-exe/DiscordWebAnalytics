import type { Metadata } from "next";
import CompareView from "@/components/views/CompareView";
import {
  DiscordComponentEmbedScript,
  buildComponentEmbed,
  socialMetadata,
} from "@/lib/discord-embed";
import { getGuildBaseUrl, getGuildContext } from "@/lib/guild-context";
import { parsePeriod, periodLabel } from "@/lib/period";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ m?: string; user_id?: string | string[] }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { m } = await searchParams;
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const period = parsePeriod(m);
  const subject = guild.name || "Discordサーバー";
  const title = `メンバー比較 (${periodLabel(period)})`;
  const description = `${subject}のメンバー同士の発言推移を比較 (${periodLabel(period)})。`;
  return socialMetadata({
    title,
    description,
    url: `${baseUrl ?? "https://ymkw.top"}/compare`,
    imageUrl: guild.iconUrl,
  });
}

export default async function ComparePage({ searchParams }: PageProps) {
  const { m, user_id } = await searchParams;
  const period = parsePeriod(m);
  const ids = Array.isArray(user_id) ? user_id : user_id ? [user_id] : [];
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const base = baseUrl ?? "https://ymkw.top";
  const subject = guild.name || "Discordサーバー";
  const label = periodLabel(period);
  const embed = buildComponentEmbed({
    title: `メンバー比較 (${label})`,
    url: `${base}/compare`,
    description: `${subject}のメンバー同士の発言推移を並べて比較できます。`,
    thumbnailUrl: guild.iconUrl,
    buttons: [
      { label: "メンバー", url: `${base}/members` },
      { label: "共通のかかわり", url: `${base}/relation` },
    ],
    footer: `${subject} ・ ${label}`,
  });
  return (
    <>
      <DiscordComponentEmbedScript payload={embed} />
      <CompareView period={period} initialUserIds={ids} />
    </>
  );
}
