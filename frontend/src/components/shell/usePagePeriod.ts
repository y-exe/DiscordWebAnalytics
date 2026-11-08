"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { resolveCurrentPeriod } from "./AppShell";

/** ページ共通: 現在の期間とモード (パス型/クエリ型) を解決する */
export function usePagePeriod() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  return resolveCurrentPeriod(pathname, searchParams.get("m"));
}
