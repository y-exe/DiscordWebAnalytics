import type { MetadataRoute } from "next";
import { getGuildBaseUrl } from "@/lib/guild-context";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = (await getGuildBaseUrl()) ?? "https://ymkw.top";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/error", "/404", "/500"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
