import { permanentRedirect } from "next/navigation";

/** 旧パス形式 (/all) からクエリ形式 (/?m=all) への後方互換リダイレクト */
export default function AllRedirectPage() {
  permanentRedirect("/?m=all");
}
