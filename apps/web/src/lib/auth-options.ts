import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";
import { prisma } from "@/lib/prisma";

type TelegramProfile = {
  sub: string;
  id?: number | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  picture?: string;
};

function optionalProfileString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function telegramProvider(): OAuthConfig<TelegramProfile> {
  return {
    id: "telegram",
    name: "Telegram",
    type: "oauth",
    wellKnown: "https://oauth.telegram.org/.well-known/openid-configuration",
    authorization: { params: { scope: "openid profile" } },
    idToken: true,
    checks: ["pkce", "state"],
    clientId: process.env.TELEGRAM_CLIENT_ID || "",
    clientSecret: process.env.TELEGRAM_CLIENT_SECRET || "",
    profile(profile) {
      return {
        id: String(profile.sub),
        name:
          optionalProfileString(profile.name)
          || optionalProfileString(profile.preferred_username)
          || "Пользователь Telegram",
        email: null,
        image: optionalProfileString(profile.picture),
      };
    },
  };
}

export function isTelegramAuthConfigured() {
  return Boolean(process.env.TELEGRAM_CLIENT_ID && process.env.TELEGRAM_CLIENT_SECRET);
}

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [telegramProvider()],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      else if (!token.userId && token.sub) token.userId = token.sub;
      return token;
    },
    async session({ session, token }) {
      const userId = token.userId || token.sub;
      if (session.user && userId) session.user.id = userId;
      return session;
    },
  },
  events: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "telegram" || !profile?.sub) return;

      const telegramProfile = profile as TelegramProfile;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          telegramId: String(telegramProfile.sub),
          telegramUsername: optionalProfileString(telegramProfile.preferred_username),
          name:
            optionalProfileString(telegramProfile.name)
            || optionalProfileString(telegramProfile.preferred_username)
            || user.name,
          image: optionalProfileString(telegramProfile.picture),
        },
      });
      await prisma.userActivityEvent.create({ data: {
        userId: user.id,
        actorUserId: user.id,
        type: "login",
        metadata: { provider: "telegram" },
      } });
    },
  },
} satisfies NextAuthOptions;
