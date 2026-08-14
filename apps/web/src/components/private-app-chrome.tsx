"use client";

import { AppHeader } from "@/components/app-header";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { MotionProvider } from "@/components/motion/motion-provider";
import { PageTransition } from "@/components/motion/page-transition";
import { type AppRouteKind, usesAccountNavigation } from "@/lib/app-route-classification";

type PrivateAppChromeProps = {
  children: React.ReactNode;
  pathname: string;
  route: Exclude<AppRouteKind, "public">;
  adminAvailable?: boolean;
};

export function PrivateAppChrome({ children, pathname, route, adminAvailable = false }: PrivateAppChromeProps) {
  const login = route === "auth";
  const accountRoute = usesAccountNavigation(route);

  return (
    <MotionProvider>
      {!login ? <AppHeader adminAvailable={adminAvailable} /> : null}
      <div className={login ? "app-content app-content-auth" : "app-content"}>
        <PageTransition routeKey={pathname}>{children}</PageTransition>
      </div>
      {!login && accountRoute ? <MobileBottomNav /> : null}
    </MotionProvider>
  );
}
