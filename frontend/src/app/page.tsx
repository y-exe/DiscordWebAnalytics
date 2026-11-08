import { permanentRedirect } from "next/navigation";

export default function Page() {
  // ダッシュボードのルートは案内ページではなく最新レポートへ誘導する
  // (案内サイトは home/ として Cloudflare Pages/Workers に別配備する)
  permanentRedirect("/month/latest");
}
