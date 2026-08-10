import NextAuth from "@studydeck/auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import authConfig, { optionalProfileString } from "@/auth.config";
import { prisma } from "@/lib/prisma";

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  ...authConfig,
  events: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "telegram" || !profile?.sub || !user.id) return;

      const telegramProfile = profile as { sub: string; name?: string; preferred_username?: string; picture?: string };
      await prisma.user.update({
        where: { id: user.id },
        data: {
          telegramId: String(telegramProfile.sub),
          telegramUsername: optionalProfileString(telegramProfile.preferred_username),
          name: optionalProfileString(telegramProfile.name) || optionalProfileString(telegramProfile.preferred_username) || user.name,
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
});
