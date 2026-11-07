import type { Metadata } from "next";
import HomePage from "@/components/HomePage";
import { getGuildContext } from "@/lib/guild-context";

export async function generateMetadata(): Promise<Metadata> {
  const guild = await getGuildContext();
  if (guild.isDefault || !guild.name) {
    return {
      title: "やまかわてるき | ymkw.top",
      description:
        "やまかわてるき鯖の公認WEBダッシュボード。月間レポートと累計ランキングを確認できます。",
      alternates: { canonical: "/" },
    };
  }
  return {
    title: guild.name,
    description: `${guild.name}の公認WEBダッシュボード。月間レポートと累計ランキングを確認できます。`,
    alternates: { canonical: "/" },
  };
}

export default async function Page() {
  const guild = await getGuildContext();
  return (
    <HomePage guild={{ name: guild.name, iconUrl: guild.iconUrl, isDefault: guild.isDefault }} />
  );
}
