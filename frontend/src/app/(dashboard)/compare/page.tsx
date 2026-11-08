import type { Metadata } from "next";
import CompareView from "@/components/views/CompareView";
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
  return {
    title,
    description,
    alternates: { canonical: `${baseUrl ?? "https://ymkw.top"}/compare` },
    openGraph: { title, description, type: "website" },
  };
}

export default async function ComparePage({ searchParams }: PageProps) {
  const { m, user_id } = await searchParams;
  const ids = Array.isArray(user_id) ? user_id : user_id ? [user_id] : [];
  return <CompareView period={parsePeriod(m)} initialUserIds={ids} />;
}
