import { describe, expect, it } from "vitest";
import { formatShortDate, planLabel } from "./project-ui";

describe("project UI formatting", () => {
  it("formats project dates in Moscow time on both server and client", () => {
    expect(formatShortDate("2026-07-09T21:31:32.550Z")).toBe("10 июл.");
  });

  it("uses the effective plan label", () => {
    expect(planLabel("free")).toBe("Бесплатный");
    expect(planLabel("student")).toBe("Студенческий");
    expect(planLabel("pro")).toBe("Профессиональный");
  });
});
