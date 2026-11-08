import type { MetadataRoute } from "next";

// PWA用のWebアプリマニフェスト。
// Service Workerは導入しない (統計データは常に最新を表示すべきで、
// オフラインキャッシュがむしろ鮮度を損なうため)。
// このファイルでインストール可能・スタンドアロン表示・アイコン・テーマ色だけを提供する。
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Discord Web Analytics",
    short_name: "Analytics",
    description: "Discordサーバーの活動量、ランキング、統計情報を可視化するダッシュボード。",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/apple-touch-icon.png",
        sizes: "144x144",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
