"use client";

import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";

const accountPrefixes = ["/dashboard", "/projects", "/new", "/folders", "/profile", "/billing", "/invite", "/admin"];

export function AppChrome({ children, adminAvailable = false }: { children: React.ReactNode; adminAvailable?: boolean }) {
  const pathname = usePathname();
  const login = pathname === "/login";
  const accountRoute = accountPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  return (
    <>
      {!login ? <AppHeader adminAvailable={adminAvailable} /> : null}
      <div className={login ? "app-content app-content-auth" : "app-content"}>{children}</div>
      {!login && accountRoute ? <MobileBottomNav /> : null}
    </>
  );
}
