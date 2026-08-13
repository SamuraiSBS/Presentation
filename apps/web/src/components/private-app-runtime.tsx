"use client";

import type { ReactNode } from "react";
import type { Session } from "@studydeck/auth";
import { PrivateAppChrome } from "@/components/private-app-chrome";
import { ProductAnalyticsPageView } from "@/components/product-analytics-page-view";
import { AppQueryProvider } from "@/components/query-provider";
import { SessionProvider } from "@/components/session-provider";
import type { AppRouteKind } from "@/lib/app-route-classification";

type PrivateAppRuntimeProps = {
  children: ReactNode;
  pathname: string;
  route: Exclude<AppRouteKind, "public">;
  session?: Session | null;
  adminAvailable?: boolean;
};

export function PrivateAppRuntime({ children, pathname, route, session, adminAvailable = false }: PrivateAppRuntimeProps) {
  return (
    <SessionProvider session={session}>
      <ProductAnalyticsPageView />
      <AppQueryProvider>
        <PrivateAppChrome adminAvailable={adminAvailable} pathname={pathname} route={route}>
          {children}
        </PrivateAppChrome>
      </AppQueryProvider>
    </SessionProvider>
  );
}
