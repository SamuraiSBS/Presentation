import { describe, expect, it } from "vitest";
import { AiScenePrototypeBudget } from "./prototype-budget.js";

describe("AI scene prototype budget", () => {
  it("reserves the two-slide image buckets before provider calls", () => {
    const budget = new AiScenePrototypeBudget();
    expect(budget.reserve("style", "style_direction")).toMatchObject({ status: "reserved", amountRub: "1.00000000" });
    expect(budget.settle("style", "0.40000000")).toMatchObject({ status: "settled" });

    expect(budget.reserve("concept-1", "slide_concept")).toMatchObject({ status: "reserved", amountRub: "4.00000000" });
    expect(budget.settle("concept-1", "3.00000000")).toMatchObject({ status: "settled" });
    expect(budget.reserve("concept-2", "slide_concept")).toMatchObject({ status: "reserved", amountRub: "5.00000000" });
    expect(budget.settle("concept-2", "5.00000000")).toMatchObject({ status: "settled" });
    expect(budget.reserve("concept-3", "slide_concept")).toEqual({ status: "ai_scene_prototype_stage_call_limit" });
  });

  it("stops rather than treating unavailable or over-budget provider cost as free", () => {
    const unavailable = new AiScenePrototypeBudget();
    expect(unavailable.reserve("layer", "layer_generation").status).toBe("reserved");
    expect(unavailable.settle("layer", undefined)).toEqual({ status: "ai_scene_prototype_cost_unavailable" });
    expect(unavailable.reserve("next", "style_direction")).toEqual({ status: "ai_scene_prototype_budget_blocked" });

    const overrun = new AiScenePrototypeBudget();
    expect(overrun.reserve("repair", "scene_repair").status).toBe("reserved");
    expect(overrun.settle("repair", "5.01000000")).toMatchObject({ status: "ai_scene_prototype_budget_overrun" });
  });

  it("enforces one repair call for the whole two-slide prototype", () => {
    const budget = new AiScenePrototypeBudget();
    expect(budget.reserve("slide-1-repair", "scene_repair")).toMatchObject({ status: "reserved" });
    expect(budget.reserve("slide-2-repair", "scene_repair")).toEqual({ status: "ai_scene_prototype_stage_call_limit" });
  });

  it("carries a prior interrupted-run spend into the absolute prototype cap", () => {
    const budget = new AiScenePrototypeBudget(undefined, "23.50000000");
    expect(budget.snapshot()).toMatchObject({ priorSettledRub: "23.50000000", settledRub: "23.50000000" });
    expect(budget.reserve("style", "style_direction")).toEqual({ status: "ai_scene_prototype_budget_exhausted_preflight" });
  });
});
