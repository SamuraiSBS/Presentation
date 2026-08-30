import type { NextAuthConfig } from "@studydeck/auth";
import type { OAuthConfig } from "@studydeck/auth/providers";

type TelegramProfile = {
  sub: string;
  id?: number | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  picture?: string;
};

export function optionalProfileString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function telegramProvider(): OAuthConfig<TelegramProfile> {
  return {
    id: "telegram",
    name: "Telegram",
    type: "oidc",
    issuer: "https://oauth.telegram.org",
    wellKnown: "https://oauth.telegram.org/.well-known/openid-configuration",
    authorization: { params: { scope: "openid profile" } },
    checks: ["pkce"],
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

const authConfig = {
  // The app is deployed behind the single trusted Caddy proxy. Auth.js v5 only
  // infers this from AUTH_URL/AUTH_TRUST_HOST, while this project configures
  // the backwards-compatible NEXTAUTH_URL variable.
  trustHost: true,
  // Auth.js v5 validates every configured OAuth provider at request time.
  // Keep the Telegram entry out of local/E2E environments until both required
  // credentials are supplied; the login UI already reflects this same state.
  providers: isTelegramAuthConfigured() ? [telegramProvider()] : [],
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      else if (!token.userId && token.sub) token.userId = token.sub;
      return token;
    },
    async session({ session, token }) {
      const tokenUserId = token.userId;
      const userId = typeof tokenUserId === "string" ? tokenUserId : token.sub;
      if (session.user && typeof userId === "string") session.user.id = userId;
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
