import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { InternalApiError } from "@/lib/internal-api";
import { devAuthAllowed } from "@studydeck/shared";

export function devAdminAllowed() {
  return process.env.ALLOW_DEV_ADMIN === "true" && process.env.DEPLOYMENT_ENV?.toLowerCase() !== "production";
}

export async function canAccessAdmin(userId?: string | null) {
  if (devAdminAllowed()) return true;
  if (!userId) return false;
  const allowed = new Set((process.env.ADMIN_TELEGRAM_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.size) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
  return Boolean(user?.telegramId && allowed.has(user.telegramId));
}

export async function requireAdminSession(options: { redirectToLogin?: boolean } = {}) {
  const session = await auth();
  const userId = session?.user?.id || (devAuthAllowed() ? process.env.TEMP_USER_ID || "local-user" : null);
  if (!userId && options.redirectToLogin) redirect("/login?callbackUrl=/admin");
  if (!userId || !(await canAccessAdmin(userId))) {
    throw new InternalApiError(403, { code: "ADMIN_ACCESS_DENIED", message: "Доступ к административной панели запрещён" });
  }
  return { userId, localAccess: devAdminAllowed() };
}
