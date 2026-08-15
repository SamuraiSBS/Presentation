import { describe, expect, it } from "vitest";
import { rateLimitProfileFor } from "./api-rate-limit.guard.js";

describe("rateLimitProfileFor", () => {
  it("gives expensive and abuse-prone endpoints separate buckets", () => {
    expect(rateLimitProfileFor("/v1/projects/project-1/uploads", "POST")).toBe("upload");
    expect(rateLimitProfileFor("/v1/projects/project-1/defense/uploads", "POST")).toBe("upload");
    expect(rateLimitProfileFor("/v1/projects/project-1/generate", "POST")).toBe("generation");
    expect(rateLimitProfileFor("/v1/projects/project-1/exports", "POST")).toBe("export");
    expect(rateLimitProfileFor("/v1/projects/project-1/invitations", "POST")).toBe("invite");
    expect(rateLimitProfileFor("/v1/billing/checkout", "POST")).toBe("billing");
  });

  it("keeps ordinary reads in the general bucket", () => {
    expect(rateLimitProfileFor("/v1/projects/project-1", "GET")).toBe("general");
  });
});
