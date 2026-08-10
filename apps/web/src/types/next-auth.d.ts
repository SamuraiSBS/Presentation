import type { DefaultSession } from "@studydeck/auth";

declare module "@studydeck/auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
    };
  }
}

declare module "@studydeck/auth/jwt" {
  interface JWT {
    userId?: string;
  }
}

export {};
