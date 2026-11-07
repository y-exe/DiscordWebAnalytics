import type { Metadata } from "next";
import { getGuildBaseUrl, getGuildContext } from "@/lib/guild-context";
import "../styles/global.css";
import "../styles/home.css";

const DEFAULT_DESCRIPTION =
  "YoutuberのDiscord鯖であるやまかわてるき鯖の活動量、ランキング、統計情報を可視化する公認WEBダッシュボード。";

export async function generateMetadata(): Promise<Metadata> {
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const metadataBase = new URL(baseUrl ?? "https://ymkw.top");
  if (guild.isDefault || !guild.name) {
    return {
      metadataBase,
      title: { default: "やまかわてるき | ymkw.top", template: "%s | やまかわてるき | ymkw.top" },
      description: DEFAULT_DESCRIPTION,
      keywords: ["やまかわてるき", "Discord統計", "Discordランキング", "ymkw.top"],
      alternates: { canonical: "/" },
      openGraph: {
        type: "website",
        locale: "ja_JP",
        siteName: "やまかわてるき鯖WEBダッシュボード",
        images: ["/ranking.webp"],
      },
      twitter: { card: "summary_large_image", images: ["/ranking.webp"] },
    };
  }
  const siteName = `${guild.name} ダッシュボード`;
  return {
    metadataBase,
    title: { default: guild.name, template: `%s | ${guild.name}` },
    description: `${guild.name}のDiscord活動量、ランキング、統計情報を可視化するダッシュボード。`,
    keywords: [guild.name, "Discord統計", "Discordランキング"],
    alternates: { canonical: "/" },
    openGraph: { type: "website", locale: "ja_JP", siteName, images: ["/ranking.webp"] },
    twitter: { card: "summary_large_image", images: ["/ranking.webp"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&family=Dela+Gothic+One&family=JetBrains+Mono:wght@400;700;900&family=Noto+Sans+JP:wght@400;700;900&family=Outfit:wght@400;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-foreground font-sans min-h-screen">{children}</body>
    </html>
  );
}
