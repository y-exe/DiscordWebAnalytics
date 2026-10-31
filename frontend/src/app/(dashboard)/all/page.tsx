import type { Metadata } from "next";
import AllTimeDashboard from "@/components/AllTimeDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "総合ランキング", description: "やまかわてるき鯖の総合ランキングと活動データです。",
  alternates: { canonical: "https://ymkw.top/all" },
  openGraph: {
    title: "全期間の発言ランキング", description: "やまかわてるき鯖の全期間ランキングと活動データです。",
    url: "https://ymkw.top/all", type: "website", images: ["https://ymkw.top/ranking.webp"],
  },
};

export default function AllPage() {
  return <>
    <link rel="discord:component-embed" type="application/json" href="https://api.ymkw.top/ranking/total/discord-embed" />
    <AllTimeDashboard channelId={null} userId={null} />
  </>;
}
