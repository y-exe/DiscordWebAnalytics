import DashboardShell from "@/components/DashboardShell";
import { Suspense } from "react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<main className="min-h-screen bg-white" />}><DashboardShell>{children}</DashboardShell></Suspense>;
}
