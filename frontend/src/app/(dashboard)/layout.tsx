import DashboardShell from "@/components/DashboardShell";
import { getGuildContext } from "@/lib/guild-context";
import { Suspense } from "react";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const guild = await getGuildContext();
  return (
    <Suspense fallback={<main className="min-h-screen bg-white" />}>
      <DashboardShell
        guild={{ name: guild.name, iconUrl: guild.iconUrl, isDefault: guild.isDefault }}
      >
        {children}
      </DashboardShell>
    </Suspense>
  );
}
