import { describe, expect, it } from "vitest";
import type { DefensePlan } from "@studydeck/shared";
import { defensePlanTiming, defenseReportIsStale, reorderDefensePlanSlides } from "./defense-ui";

function plan(): DefensePlan {
  return {
    version: 1,
    defenseType: "hackathon",
    complianceMode: "strict",
    presetVersion: "hackathon-v1",
    status: "draft",
    approvedAt: null,
    totalTimingSeconds: 80,
    slides: [
      { id: "a", order: 1, title: "A", purpose: "A", timingSeconds: 40, requirementIds: [], factIds: [], assetSourceIds: [], placeholders: [], visualStrategy: "", origin: "builtin", presetSlideKey: "a" },
      { id: "b", order: 2, title: "B", purpose: "B", timingSeconds: 40, requirementIds: [], factIds: [], assetSourceIds: [], placeholders: [], visualStrategy: "", origin: "builtin", presetSlideKey: "b" },
    ],
  };
}

describe("defense UI helpers", () => {
  it("keeps plan order contiguous after moving a slide", () => {
    const moved = reorderDefensePlanSlides(plan(), 1, 0);
    expect(moved.slides.map((slide) => [slide.id, slide.order])).toEqual([["b", 1], ["a", 2]]);
    expect(moved.totalTimingSeconds).toBe(80);
  });

  it("sums slide timing", () => {
    expect(defensePlanTiming(plan().slides)).toBe(80);
  });

  it("marks a report stale only when revisions differ", () => {
    expect(defenseReportIsStale({ presentationRevision: 3, stale: false }, 4)).toBe(true);
    expect(defenseReportIsStale({ presentationRevision: 4, stale: false }, 4)).toBe(false);
    expect(defenseReportIsStale({ presentationRevision: 4, stale: true }, 4)).toBe(true);
  });
});
