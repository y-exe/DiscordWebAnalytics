import type { MetadataRoute } from "next";

const siteUrl = "https://www.ymkw.top";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const months = Array.from({ length: 24 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index - 1, 1);
    return { url: `${siteUrl}/month/${date.getFullYear()}/${date.getMonth() + 1}`, lastModified: date, changeFrequency: "monthly" as const, priority: 0.8 };
  });
  return [
    { url: siteUrl, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/all`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${siteUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    ...months,
  ];
}
