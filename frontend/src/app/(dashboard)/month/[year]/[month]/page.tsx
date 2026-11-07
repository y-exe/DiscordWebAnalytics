import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminMonthGate from "@/components/AdminMonthGate";
import { getGuildBaseUrl, getGuildContext } from "@/lib/guild-context";
import { isPublishedReportMonth } from "@/lib/report-period";

type PageProps = { params: Promise<{ year: string; month: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { year, month } = await params;
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const targetYear = Number(year);
  const targetMonth = Number(month);
  const title = `${targetYear}年${targetMonth}月レポート`;
  const subject = guild.isDefault || !guild.name ? "やまかわてるき鯖" : guild.name;
  const description = `${targetYear}年${targetMonth}月の${subject}の活動データです。`;
  const url = `${baseUrl ?? "https://ymkw.top"}/month/${targetYear}/${targetMonth}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: [`${baseUrl ?? "https://ymkw.top"}/ranking.webp`],
    },
  };
}

export default async function MonthPage({ params }: PageProps) {
  const { year, month } = await params;
  const targetYear = Number(year);
  const targetMonth = Number(month);
  if (
    !Number.isInteger(targetYear) ||
    targetYear < 2020 ||
    targetYear > 2100 ||
    !Number.isInteger(targetMonth) ||
    targetMonth < 1 ||
    targetMonth > 12
  )
    notFound();
  const baseUrl = await getGuildBaseUrl();
  return (
    <>
      {isPublishedReportMonth(targetYear, targetMonth) && (
        <link
          rel="discord:component-embed"
          type="application/json"
          href={`${baseUrl ?? "https://api.ymkw.top"}/ranking/monthly/${targetYear}/${targetMonth}/discord-embed`}
        />
      )}
      <AdminMonthGate year={year} month={month} />
    </>
  );
}
