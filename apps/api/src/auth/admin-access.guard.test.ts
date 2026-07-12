import { describe, expect, it, vi } from "vitest";
import { AdminAccessGuard } from "./admin-access.guard.js";

function context(userId = "user-1") { return { switchToHttp: () => ({ getRequest: () => ({ userId }) }) } as never; }

describe("AdminAccessGuard", () => {
  it("allows the explicit local flag outside production", async () => {
    const config = { get: (key: string) => ({ ALLOW_DEV_ADMIN: "true", DEPLOYMENT_ENV: "local" })[key] };
    const guard = new AdminAccessGuard(config as never, { user: { findUnique: vi.fn() } } as never);
    await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it("fails closed with an empty production allowlist", async () => {
    const config = { get: (key: string) => ({ ALLOW_DEV_ADMIN: "false", DEPLOYMENT_ENV: "production", ADMIN_TELEGRAM_IDS: "" })[key] };
    const guard = new AdminAccessGuard(config as never, { user: { findUnique: vi.fn() } } as never);
    await expect(guard.canActivate(context())).rejects.toMatchObject({ status: 403 });
  });

  it("uses Telegram ID, not username", async () => {
    const config = { get: (key: string) => ({ ALLOW_DEV_ADMIN: "false", DEPLOYMENT_ENV: "production", ADMIN_TELEGRAM_IDS: "12345" })[key] };
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue({ telegramId: "12345", telegramUsername: "admin" }) } };
    const guard = new AdminAccessGuard(config as never, prisma as never);
    await expect(guard.canActivate(context())).resolves.toBe(true);
  });
});
