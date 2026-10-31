import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminMonthGate from "@/components/AdminMonthGate";
import { isPublishedReportMonth } from "@/lib/report-period";

type PageProps = { params: Promise<{ year: string; month: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { year, month } = await params;
  const title = `${year}年${month}月レポート`;
  const description = `${year}年${month}月のやまかわてるき鯖の活動データです。`;
  const url = `https://ymkw.top/month/${Number(year)}/${Number(month)}`;
  return {
    title, description, alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: ["https://ymkw.top/ranking.webp"] },
  };
}

export default async function MonthPage({ params }: PageProps) {
  const { year, month } = await params;
  const targetYear = Number(year);
  const targetMonth = Number(month);
  if (!Number.isInteger(targetYear) || targetYear < 2020 || targetYear > 2100 || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) notFound();
  return <>
    {isPublishedReportMonth(targetYear, targetMonth) && <link
      rel="discord:component-embed"
      type="application/json"
      href={`https://api.ymkw.top/ranking/monthly/${targetYear}/${targetMonth}/discord-embed`}
    />}
    <AdminMonthGate year={year} month={month} />
  </>;
}
