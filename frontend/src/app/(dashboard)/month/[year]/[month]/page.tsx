import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminMonthGate from "@/components/AdminMonthGate";

type PageProps = { params: Promise<{ year: string; month: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { year, month } = await params;
  return { title: `${year}年${month}月レポート`, description: `${year}年${month}月のやまかわてるき鯖の活動データです。` };
}

export default async function MonthPage({ params }: PageProps) {
  const { year, month } = await params;
  const targetYear = Number(year);
  const targetMonth = Number(month);
  if (!Number.isInteger(targetYear) || targetYear < 2020 || targetYear > 2100 || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) notFound();
  return <AdminMonthGate year={year} month={month} />;
}
