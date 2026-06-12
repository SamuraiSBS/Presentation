import { describe, expect, it } from "vitest";
import { createProjectInputSchema, planLimits, presentationSchema } from "./index";

describe("shared contracts", () => {
  it("validates project input limits", () => {
    expect(() =>
      createProjectInputSchema.parse({
        title: "AI in education",
        prompt: "Сделай понятную презентацию по теме искусственного интеллекта в образовании",
        scenario: "school_report",
        level: "8-11 класс",
        mode: "with_sources",
        slideCount: 10,
      }),
    ).not.toThrow();
  });

  it("keeps free plan export limited to pdf", () => {
    expect(planLimits.free.exports).toEqual(["pdf"]);
  });

  it("requires a structured presentation document", () => {
    expect(() => presentationSchema.parse({ id: "x" })).toThrow();
  });
});
