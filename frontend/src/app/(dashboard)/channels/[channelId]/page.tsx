import type { Metadata } from "next";
import ChannelDetailView from "@/components/views/ChannelDetailView";
import { getGuildContext } from "@/lib/guild-context";
import { parsePeriod } from "@/lib/period";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ channelId: string }>; searchParams: Promise<{ m?: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { channelId } = await params;
  const guild = await getGuildContext();
  const subject = guild.name || "Discordサーバー";
  return {
    title: `チャンネル詳細 (${channelId})`,
    description: `${subject}のチャンネル (ID: ${channelId}) の活動データ。`,
  };
}

export default async function ChannelDetailPage({ params, searchParams }: PageProps) {
  const { channelId } = await params;
  const { m } = await searchParams;
  if (!/^\d+$/.test(channelId)) return null;
  return <ChannelDetailView channelId={channelId} period={parsePeriod(m)} />;
}
