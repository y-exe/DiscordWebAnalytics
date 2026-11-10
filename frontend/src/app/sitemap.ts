import type { MetadataRoute } from "next";
import { getGuildBaseUrl } from "@/lib/guild-context";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (await getGuildBaseUrl()) ?? "https://ymkw.top";
  const siteUrl = base.replace(/\/$/, "");
  const now = new Date();
  const months = Array.from({ length: 24 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index - 1, 1);
    return {
      url: `${siteUrl}/?m=${date.getFullYear()}-${date.getMonth() + 1}`,
      lastModified: date,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    };
  });
  return [
    { url: siteUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/?m=all`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    ...months,
  ];
}
