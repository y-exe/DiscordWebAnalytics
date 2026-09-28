"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export default function DashboardLoadingScreen() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() ?? "";
  const [visible, setVisible] = useState(true);
  const [closing, setClosing] = useState(false);

  const startTimeRef = useRef(Date.now());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAllTimers = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearAllTimers();
    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, 1200 - elapsed);

    hideTimerRef.current = setTimeout(() => {
      setClosing(true);
      closeTimerRef.current = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, 500);
    }, remaining);
  }, [clearAllTimers]);

  const show = useCallback(() => {
    clearAllTimers();
    startTimeRef.current = Date.now();
    setVisible(true);
    setClosing(false);

    safetyTimerRef.current = setTimeout(() => {
      hide();
    }, 6000);
  }, [clearAllTimers, hide]);

  useEffect(() => {
    show();
  }, [pathname, searchKey, show]);

  useEffect(() => {
    safetyTimerRef.current = setTimeout(() => {
      hide();
    }, 6000);

    const handleNavigation = () => show();
    const handleLoaded = () => hide();

    window.addEventListener("ymkw:dashboard-navigation", handleNavigation);
    window.addEventListener("app-loaded", handleLoaded);

    return () => {
      clearAllTimers();
      window.removeEventListener("ymkw:dashboard-navigation", handleNavigation);
      window.removeEventListener("app-loaded", handleLoaded);
    };
  }, [show, hide, clearAllTimers]);

  if (!visible) return null;
  return (
    <div
      className={`dashboard-loader ${closing ? "is-closing" : ""}`}
      role="status"
      aria-label="ダッシュボードを読み込んでいます"
    >
      <div className="dashboard-loader-grid" aria-hidden="true">
        <span className="dashboard-loader-char dashboard-loader-char-1">か</span>
        <span className="dashboard-loader-char dashboard-loader-char-2">や</span>
        <span className="dashboard-loader-char dashboard-loader-char-3">わ</span>
        <span className="dashboard-loader-char dashboard-loader-char-4">ま</span>
      </div>
    </div>
  );
}
