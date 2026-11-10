import type { Metadata } from "next";
import RelationGraphView from "@/components/views/RelationGraphView";
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
  return {
    title,
    description,
    alternates: { canonical: `${baseUrl ?? "https://ymkw.top"}/relation` },
    openGraph: { title, description, type: "website" },
  };
}

export default async function RelationPage({ searchParams }: PageProps) {
  const { m } = await searchParams;
  return <RelationGraphView period={parsePeriod(m)} />;
}
