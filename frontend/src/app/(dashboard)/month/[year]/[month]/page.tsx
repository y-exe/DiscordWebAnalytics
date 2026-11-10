import { permanentRedirect } from "next/navigation";

/** 旧パス形式 (/month/Y/M) からクエリ形式 (/?m=Y-M) への後方互換リダイレクト。
 * Botのランキング投稿やOGPが旧URLでリンクしてくるため残す */
export default async function MonthRedirectPage({
  params,
}: {
  params: Promise<{ year: string; month: string }>;
}) {
  const { year, month } = await params;
  permanentRedirect(`/?m=${year}-${month}`);
}
