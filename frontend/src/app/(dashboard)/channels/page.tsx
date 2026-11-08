import type { Metadata } from "next";
import ChannelsView from "@/components/views/ChannelsView";
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
  return {
    title,
    description,
    alternates: { canonical: `${baseUrl ?? "https://ymkw.top"}/channels` },
    openGraph: { title, description, type: "website" },
  };
}

export default async function ChannelsPage({ searchParams }: PageProps) {
  const { m } = await searchParams;
  return <ChannelsView period={parsePeriod(m)} />;
}
