import { describe, expect, it, vi } from "vitest";
import { BlockedUserGuard } from "./blocked-user.guard.js";

function context(userId: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ userId }) }),
  } as never;
}

describe("BlockedUserGuard", () => {
  it("provisions a missing profile after an authenticated first sign-in", async () => {
    const prisma = {
      user: {
        upsert: vi.fn().mockResolvedValue({ id: "user-1", blockedAt: null, blockReason: null, lastSeenAt: new Date() }),
        updateMany: vi.fn(),
      },
    };
    const guard = new BlockedUserGuard(prisma as never);

    await expect(guard.canActivate(context("user-1"))).resolves.toBe(true);
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { id: "user-1" },
      create: { id: "user-1" },
      update: {},
      select: { id: true, blockedAt: true, blockReason: true, lastSeenAt: true },
    });
  });

  it("continues to reject a blocked user", async () => {
    const prisma = {
      user: {
        upsert: vi.fn().mockResolvedValue({ id: "user-1", blockedAt: new Date(), blockReason: "manual review", lastSeenAt: null }),
        updateMany: vi.fn(),
      },
    };
    const guard = new BlockedUserGuard(prisma as never);

    await expect(guard.canActivate(context("user-1"))).rejects.toThrow("Аккаунт временно заблокирован");
  });
});
