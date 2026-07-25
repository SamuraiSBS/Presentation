import { describe, expect, it } from "vitest";
import {
  AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS,
  AitunnelProjectBudget,
  aitunnelModelForStage,
  aitunnelNarrationBudgetConfig,
  canStartCall,
  estimateInputTokens,
  remainingBudget,
  reserveNarrationCall,
  settleCall,
} from "./aitunnel-narration-budget.js";

describe("AITUNNEL narration budget", () => {
  it("routes only the three compact structured stages to the exact Lite model", () => {
    expect(aitunnelModelForStage("narrative_plan")).toBe("gemini-3.5-flash-lite");
    expect(aitunnelModelForStage("design_brief")).toBe("gemini-3.5-flash-lite");
    expect(aitunnelModelForStage("quality_critique")).toBe("gemini-3.5-flash-lite");
    expect(aitunnelModelForStage("narration")).toBe("gemini-3.6-flash");
    expect(aitunnelModelForStage("presentation")).toBe("gemini-3.6-flash");
    expect(aitunnelModelForStage("quality_repair")).toBe("gemini-3.6-flash");
    expect(aitunnelModelForStage("narrative_plan", { AITUNNEL_ECONOMY_MODEL: "auto" })).toBeUndefined();
    expect(aitunnelModelForStage("narrative_plan", { AITUNNEL_ECONOMY_MODEL: "other" })).toBeUndefined();
  });

  it("applies project and narration caps independently and stops after unavailable usage", () => {
    const budget = new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "30", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "20" });
    const reserved = budget.reserve("plan", "narrative_plan", { prompt: "small" });
    expect(reserved.status).toBe("reserved");
    expect(budget.settle("plan", { inputTokens: 100, outputTokens: 100 })).toMatchObject({ status: "settled" });
    const narration = budget.reserve("narration", "narration", { prompt: "speech" });
    expect(narration.status).toBe("reserved");
    expect(budget.settle("narration", undefined)).toEqual({ status: "aitunnel_usage_unavailable" });
    expect(budget.reserve("presentation", "presentation", { prompt: "later" })).toEqual({ status: "aitunnel_project_budget_overrun" });
  });
  it("uses bounded defaults when environment values are absent or invalid", () => {
    expect(aitunnelNarrationBudgetConfig({})).toEqual({ budgetRub: "20", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" });
    expect(aitunnelNarrationBudgetConfig({
      AITUNNEL_NARRATION_JOB_BUDGET_RUB: "0",
      AITUNNEL_NARRATION_MAX_OUTPUT_TOKENS: "-1",
      AITUNNEL_NARRATION_REASONING_EFFORT: "unlimited",
    })).toEqual({ budgetRub: "20", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" });
  });

  it("reserves conservative serialized input plus the entire output cap without float drift", () => {
    const estimate = estimateInputTokens({ input: "Пример запроса" });
    expect(estimate).toBeGreaterThan(0);
    const reservation = reserveNarrationCall({ estimatedInputTokens: 932, maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS });
    expect(reservation.costRub).toBe("3.49531000");
    expect(canStartCall({ remainingBudgetRub: "4.25000000", reservation })).toBe(true);
    expect(canStartCall({ remainingBudgetRub: "3.49530999", reservation })).toBe(false);
  });

  it("settles actual usage, returns unused reservation, and detects provider overruns", () => {
    const reservation = reserveNarrationCall({ estimatedInputTokens: 1_000, maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS });
    const settled = settleCall({ reservation, actualUsage: { inputTokens: 900, outputTokens: 1_250 } });
    expect(settled).toMatchObject({ status: "settled", actualCostRub: "3.25325000", overrun: false });
    if (settled.status === "settled") expect(remainingBudget("20", settled.actualCostRub)).toBe("16.74675000");
    expect(settleCall({ reservation, actualUsage: { inputTokens: 1_000, outputTokens: 1_351 } })).toMatchObject({ status: "settled", overrun: true });
  });

  it("never treats missing usage as free", () => {
    const reservation = reserveNarrationCall({ estimatedInputTokens: 1, maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS });
    expect(settleCall({ reservation, actualUsage: undefined })).toEqual({ status: "usage_unavailable" });
  });
});
