"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export default function DashboardLoadingScreen() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() ?? "";
  const [visible, setVisible] = useState(true);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const startedAt = Date.now();
    setVisible(true);
    setClosing(false);
    const hide = () => {
      const remaining = Math.max(0, 1200 - (Date.now() - startedAt));
      window.setTimeout(() => {
        setClosing(true);
        window.setTimeout(() => setVisible(false), 500);
      }, remaining);
    };
    window.addEventListener("app-loaded", hide, { once: true });
    return () => window.removeEventListener("app-loaded", hide);
  }, [pathname, searchKey]);

  useEffect(() => {
    const showLoader = () => {
      setVisible(true);
      setClosing(false);
    };
    window.addEventListener("ymkw:dashboard-navigation", showLoader);
    return () => window.removeEventListener("ymkw:dashboard-navigation", showLoader);
  }, []);

  if (!visible) return null;
  return <div className={`dashboard-loader ${closing ? "is-closing" : ""}`} role="status" aria-label="ダッシュボードを読み込んでいます"><div className="dashboard-loader-grid" aria-hidden="true"><span className="dashboard-loader-char dashboard-loader-char-1">か</span><span className="dashboard-loader-char dashboard-loader-char-2">や</span><span className="dashboard-loader-char dashboard-loader-char-3">わ</span><span className="dashboard-loader-char dashboard-loader-char-4">ま</span></div></div>;
}
