"use client";

import type { ReactNode } from "react";
import type { Session } from "@studydeck/auth";
import { SessionProvider as NextAuthSessionProvider } from "@studydeck/auth/react";

export function SessionProvider({
  children,
  session,
}: {
  children: ReactNode;
  session?: Session | null;
}) {
  return (
    <NextAuthSessionProvider session={session}>
      {children}
    </NextAuthSessionProvider>
  );
}
