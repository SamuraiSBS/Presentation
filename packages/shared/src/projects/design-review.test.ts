import { describe, expect, it } from "vitest";
import { canvasDiagramElementSchema } from "../presentation/schemas.js";
import { costEnvelopePolicyIsValid, designReviewRegenerationCostPolicy } from "../generation/cost-envelope.js";
import { approveDesignCandidateInputSchema, regenerateDesignCandidateInputSchema } from "./inputs.js";

describe("design review contracts", () => {
  it("requires an optimistic revision for every review action", () => {
    expect(approveDesignCandidateInputSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(regenerateDesignCandidateInputSchema.safeParse({ expectedRevision: 3, comment: "  " }).success).toBe(false);
  });

  it("keeps diagram topology typed while labels and values stay editable", () => {
    expect(canvasDiagramElementSchema.safeParse({
      id: "diagram-1", type: "diagram", x: 0, y: 0, w: 400, h: 240, rotation: 0, zIndex: 2, opacity: 1, locked: false,
      model: { kind: "scheme", template: "flow", nodes: [{ id: "a", label: "Вход" }], edges: [] },
    }).success).toBe(true);
  });

  it("uses a bounded, separate budget for one design retry", () => {
    const policy = designReviewRegenerationCostPolicy();
    expect(costEnvelopePolicyIsValid(policy)).toBe(true);
    expect(policy.buckets).toEqual({ design_regeneration: "2.00000000", images: "1.20000000" });
  });
});
