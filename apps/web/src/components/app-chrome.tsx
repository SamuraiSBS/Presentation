"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { Session } from "@studydeck/auth";
import { PublicHeader } from "@/components/landing/public-header";
import { PublicFooter } from "@/components/landing/public-footer";
import { classifyAppRoute } from "@/lib/app-route-classification";

const PrivateAppRuntime = dynamic(
  () => import("@/components/private-app-runtime").then((module) => module.PrivateAppRuntime),
  { ssr: false },
);

export function AppChrome({
  children,
  session,
  adminAvailable = false,
}: {
  children: React.ReactNode;
  session?: Session | null;
  adminAvailable?: boolean;
}) {
  const pathname = usePathname();
  const route = classifyAppRoute(pathname);

  if (route === "public") {
    return (
      <>
        <PublicHeader isAuthenticated={Boolean(session?.user?.id)} />
        <div className="app-content app-content-public">
          <div className="motion-page" data-route-key={pathname}>{children}</div>
        </div>
        <PublicFooter />
      </>
    );
  }

  return (
    <PrivateAppRuntime adminAvailable={adminAvailable} pathname={pathname} route={route} session={session}>
      {children}
    </PrivateAppRuntime>
  );
}
