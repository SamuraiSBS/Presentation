"use client";

import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { PublicHeader } from "@/components/landing/public-header";
import { classifyAppRoute, usesAccountNavigation } from "@/lib/app-route-classification";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { MotionProvider } from "@/components/motion/motion-provider";
import { PageTransition } from "@/components/motion/page-transition";
import { PublicFooter } from "@/components/landing/public-footer";

export function AppChrome({ children, adminAvailable = false }: { children: React.ReactNode; adminAvailable?: boolean }) {
  const pathname = usePathname();
  const route = classifyAppRoute(pathname);
  const login = route === "auth";
  const publicLanding = route === "public";
  const accountRoute = usesAccountNavigation(route);

  return (
    <MotionProvider>
      {publicLanding ? <PublicHeader /> : !login ? <AppHeader adminAvailable={adminAvailable} /> : null}
      <div className={login ? "app-content app-content-auth" : publicLanding ? "app-content app-content-public" : "app-content"}>
        <PageTransition routeKey={pathname}>{children}</PageTransition>
      </div>
      {publicLanding ? <PublicFooter /> : null}
      {!login && accountRoute ? <MobileBottomNav /> : null}
    </MotionProvider>
  );
}
