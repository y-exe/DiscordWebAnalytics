import type { Metadata } from "next";
import AllTimeDashboard from "@/components/AllTimeDashboard";
import { getGuildBaseUrl, getGuildContext } from "@/lib/guild-context";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const base = baseUrl ?? "https://ymkw.top";
  const subject = guild.isDefault || !guild.name ? "やまかわてるき鯖" : guild.name;
  return {
    title: "総合ランキング",
    description: `${subject}の総合ランキングと活動データです。`,
    alternates: { canonical: `${base}/all` },
    openGraph: {
      title: "全期間の発言ランキング",
      description: `${subject}の全期間ランキングと活動データです。`,
      url: `${base}/all`,
      type: "website",
      images: [`${base}/ranking.webp`],
    },
  };
}

export default async function AllPage() {
  const baseUrl = await getGuildBaseUrl();
  return (
    <>
      <link
        rel="discord:component-embed"
        type="application/json"
        href={`${baseUrl ?? "https://api.ymkw.top"}/ranking/total/discord-embed`}
      />
      <AllTimeDashboard channelId={null} userId={null} />
    </>
  );
}
