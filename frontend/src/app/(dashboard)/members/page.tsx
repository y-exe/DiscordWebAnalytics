import type { Metadata } from "next";
import MembersView from "@/components/views/MembersView";
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
  return {
    title,
    description,
    alternates: { canonical: `${baseUrl ?? "https://ymkw.top"}/members` },
    openGraph: { title, description, type: "website" },
  };
}

export default async function MembersPage({ searchParams }: PageProps) {
  const { m } = await searchParams;
  return <MembersView period={parsePeriod(m)} />;
}
