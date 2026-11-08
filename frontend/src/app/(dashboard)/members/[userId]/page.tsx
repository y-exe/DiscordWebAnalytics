import type { Metadata } from "next";
import MemberDetailView from "@/components/views/MemberDetailView";
import { getGuildContext } from "@/lib/guild-context";
import { parsePeriod } from "@/lib/period";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ userId: string }>; searchParams: Promise<{ m?: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { userId } = await params;
  const guild = await getGuildContext();
  const subject = guild.name || "Discordサーバー";
  return {
    title: `メンバー詳細 (${userId})`,
    description: `${subject}のメンバー (ID: ${userId}) の活動データ。`,
  };
}

export default async function MemberDetailPage({ params, searchParams }: PageProps) {
  const { userId } = await params;
  const { m } = await searchParams;
  if (!/^\d+$/.test(userId)) return null;
  return <MemberDetailView userId={userId} period={parsePeriod(m)} />;
}
