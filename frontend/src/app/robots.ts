import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/error", "/404", "/500"] }, sitemap: "https://www.ymkw.top/sitemap.xml" };
}
