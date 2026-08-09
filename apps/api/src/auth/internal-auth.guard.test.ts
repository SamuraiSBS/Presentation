import { describe, expect, it } from "vitest";
import { InternalAuthGuard } from "./internal-auth.guard.js";

function context(headers: Record<string, string | undefined>) {
  const request = {
    header: (name: string) => headers[name],
    userId: "",
  };
  return {
    context: { switchToHttp: () => ({ getRequest: () => request }) } as never,
    request,
  };
}

describe("InternalAuthGuard", () => {
  it("does not trust a local user header when production also has a dev flag", () => {
    const config = {
      get: (key: string) => ({
        ALLOW_DEV_AUTH: "true",
        DEPLOYMENT_ENV: "production",
        INTERNAL_API_TOKEN: "expected-token",
      })[key],
    };
    const guard = new InternalAuthGuard(config as never);
    const request = context({ "x-user-id": "attacker" });

    expect(() => guard.canActivate(request.context)).toThrow(/Invalid internal API credentials/);
  });

  it("accepts a signed internal request in production", () => {
    const config = {
      get: (key: string) => ({
        ALLOW_DEV_AUTH: "false",
        DEPLOYMENT_ENV: "production",
        INTERNAL_API_TOKEN: "expected-token",
      })[key],
    };
    const guard = new InternalAuthGuard(config as never);
    const request = context({ "x-user-id": "user-1", "x-internal-token": "expected-token" });

    expect(guard.canActivate(request.context)).toBe(true);
    expect(request.request.userId).toBe("user-1");
  });
});
