import type { Metadata } from "next";
import AllTimeDashboard from "@/components/AllTimeDashboard";

export const metadata: Metadata = { title: "総合ランキング", description: "やまかわてるき鯖の総合ランキングと活動データです。" };

export default function AllPage() {
  return <AllTimeDashboard channelId={null} userId={null} />;
}
