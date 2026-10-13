import { Outlet } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { api } from "@convex/_generated/api.ts";

import { useUserKey } from "@/hooks/useUserKey.tsx";
import { TooltipProvider } from "@/components/shadcn/tooltip.tsx";
import { AppRail } from "@/components/app-rail.tsx";
import { NewKeyDialog } from "@/components/auth/new-key-dialog.tsx";
import { LoginScreen } from "@/components/auth/login-screen.tsx";
import { PageLoading } from "@/components/page-loading.tsx";

/** App-Rahmen: ohne gültigen Code nur der Login, sonst Tool-Navigation links (mobil oben) und die aktive Route. */
export function AppShell() {
  const { userKey } = useUserKey();
  const me = useQuery(api.users.me, userKey ? { key: userKey } : "skip");

  if (!userKey) return <LoginScreen />;
  if (me === undefined) {
    return (
      <div className="flex h-svh bg-background">
        <PageLoading />
      </div>
    );
  }
  if (me === null) return <LoginScreen notice="Der gespeicherte Code ist unbekannt. Bitte logge dich erneut ein." />;

  return (
    <TooltipProvider>
      <div className="flex h-svh overflow-hidden bg-background text-foreground max-md:flex-col max-md:*:min-h-0">
        <AppRail userKey={userKey} userName={me.name} />
        <Outlet />
      </div>
      <NewKeyDialog userKey={userKey} />
    </TooltipProvider>
  );
}
