import type { Metadata, Viewport } from "next";
import { getGuildBaseUrl, getGuildContext } from "@/lib/guild-context";
import ThemeProvider from "@/components/ThemeProvider";
import "../styles/global.css";
import "../styles/home.css";

const DEFAULT_DESCRIPTION =
  "Discordサーバーの活動量、ランキング、統計情報を可視化するダッシュボード。";

export async function generateMetadata(): Promise<Metadata> {
  const [guild, baseUrl] = await Promise.all([getGuildContext(), getGuildBaseUrl()]);
  const metadataBase = new URL(baseUrl ?? "https://ymkw.top");
  const subject = guild.name || "Discord Analytics";
  return {
    metadataBase,
    title: { default: `${subject} ダッシュボード`, template: `%s | ${subject} ダッシュボード` },
    description: `${subject}のDiscord活動量、ランキング、統計情報を可視化するダッシュボード。`,
    keywords: [subject, "Discord統計", "Discordランキング", "ダッシュボード"],
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: "ja_JP",
      siteName: `${subject} ダッシュボード`,
      images: ["/ranking.webp"],
    },
    twitter: { card: "summary_large_image", images: ["/ranking.webp"] },
  };
}

// OSテーマに応じたステータスバー/フレーム色。ダークはglobal.cssの--background (0 0% 3.9%) と一致させる
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

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
      <body className="bg-background text-foreground font-sans min-h-screen">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
