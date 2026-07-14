import { describe, expect, it } from "vitest";
import { classifyAppRoute, usesAccountNavigation } from "./app-route-classification";

describe("app route classification", () => {
  it("keeps the landing public and login compact", () => {
    expect(classifyAppRoute("/")).toBe("public");
    expect(classifyAppRoute("/login")).toBe("auth");
    expect(usesAccountNavigation(classifyAppRoute("/"))).toBe(false);
  });

  it("preserves the account chrome for product routes", () => {
    expect(classifyAppRoute("/dashboard")).toBe("account");
    expect(classifyAppRoute("/projects/project-42/editor")).toBe("editor");
    expect(classifyAppRoute("/projects/project-42/script")).toBe("editor");
    expect(classifyAppRoute("/admin/users")).toBe("admin");
    expect(usesAccountNavigation(classifyAppRoute("/projects/project-42/editor"))).toBe(true);
  });
});
