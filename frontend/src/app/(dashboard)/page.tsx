import type { Metadata } from "next";
import RestrictedMonthGate from "@/components/views/RestrictedMonthGate";
import SummaryView from "@/components/views/SummaryView";
import { getGuildBaseUrl, getGuildContext } from "@/lib/guild-context";
import { isPublishedReportMonth } from "@/lib/report-period";
import { defaultPeriod, parsePeriod, periodLabel } from "@/lib/period";

type PageProps = { searchParams: Promise<{ m?: string }> };

/** 既定期間 (最新公開月) はクエリなしの / を正とする */
function canonicalPathForSearch(m: string | undefined): string {
  const period = parsePeriod(m);
  if (period.isAll) return "/?m=all";
  return period.key === defaultPeriod().key ? "/" : `/?m=${period.key}`;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { m } = await searchParams;
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const base = baseUrl ?? "https://ymkw.top";
  const subject = guild.name || "Discordサーバー";
  const period = parsePeriod(m);
  const title = period.isAll ? "総合ランキング" : `${periodLabel(period)}の統計`;
  const description = period.isAll
    ? `${subject}の総合ランキングと活動データです。`
    : `${periodLabel(period)}の${subject}の活動データです。`;
  const url = `${base}${canonicalPathForSearch(m)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: [`${base}/ranking.webp`],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${base}/ranking.webp`],
    },
  };
}

export default async function SummaryPage({ searchParams }: PageProps) {
  const { m } = await searchParams;
  const period = parsePeriod(m);
  const baseUrl = await getGuildBaseUrl();
  const embedBase = baseUrl ? `${baseUrl}/api` : "https://api.ymkw.top";

  if (period.isAll) {
    return (
      <>
        <link
          rel="discord:component-embed"
          type="application/json"
          href={`${embedBase}/ranking/total/discord-embed`}
        />
        <SummaryView year={null} month={null} isAll={true} />
      </>
    );
  }

  const year = period.year ?? 0;
  const month = period.month ?? 0;
  const isPublished = isPublishedReportMonth(year, month);
  return (
    <>
      {isPublished && (
        <link
          rel="discord:component-embed"
          type="application/json"
          href={`${embedBase}/ranking/monthly/${year}/${month}/discord-embed`}
        />
      )}
      {isPublished ? (
        <SummaryView year={year} month={month} isAll={false} />
      ) : (
        <RestrictedMonthGate label={`${periodLabel(period)}のレポート`}>
          <SummaryView year={year} month={month} isAll={false} />
        </RestrictedMonthGate>
      )}
    </>
  );
}
