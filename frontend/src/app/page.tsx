import type { Metadata } from "next";
import HomePage from "@/components/HomePage";

export const metadata: Metadata = { title: "やまかわてるき | ymkw.top", description: "やまかわてるき鯖の公認WEBダッシュボード。月間レポートと累計ランキングを確認できます。", alternates: { canonical: "/" } };
export default function Page() { return <HomePage />; }
