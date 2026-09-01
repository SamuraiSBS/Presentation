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
  reserveAitunnelStageCall,
  settleCall,
} from "./aitunnel-narration-budget.js";

describe("AITUNNEL narration budget", () => {
  it("routes every standard generation stage through Luna", () => {
    expect(aitunnelModelForStage("narrative_plan")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("design_brief")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("quality_critique")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("narration_section_1_candidate")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("narration_section_1_fallback")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("narration_global_rewrite")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("narration")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("narration_full_candidate")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("narration_full_rewrite")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("narration_targeted_repair")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("presentation")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("quality_repair")).toBe("gpt-5.6-luna");
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
    expect(aitunnelNarrationBudgetConfig({})).toEqual({ budgetRub: "10", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" });
    expect(aitunnelNarrationBudgetConfig({
      AITUNNEL_NARRATION_JOB_BUDGET_RUB: "0",
      AITUNNEL_NARRATION_MAX_OUTPUT_TOKENS: "-1",
      AITUNNEL_NARRATION_REASONING_EFFORT: "unlimited",
    })).toEqual({ budgetRub: "10", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" });
  });

  it("reserves conservative serialized input plus the entire output cap without float drift", () => {
    const estimate = estimateInputTokens({ input: "Пример запроса" });
    expect(estimate).toBeGreaterThan(0);
    const reservation = reserveNarrationCall({ estimatedInputTokens: 932, maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS });
    expect(reservation.costRub).toBe("0.06472000");
    expect(canStartCall({ remainingBudgetRub: "0.75000000", reservation })).toBe(true);
    expect(canStartCall({ remainingBudgetRub: "0.06471999", reservation })).toBe(false);
  });

  it("keeps worst-case compact candidate and fallback requests inside their buckets", () => {
    const request = { input: [{ role: "system", content: "compact system" }, { role: "user", content: "compact Russian section prompt" }] };
    expect(Number(reserveAitunnelStageCall("narration_section_1_candidate", request)!.costRub)).toBeLessThanOrEqual(0.25);
    expect(Number(reserveAitunnelStageCall("narration_section_1_fallback", request)!.costRub)).toBeLessThanOrEqual(1.2);
    expect(Number(reserveAitunnelStageCall("narration_global_rewrite", request)!.costRub)).toBeLessThanOrEqual(1.2);
  });

  it("settles actual usage, returns unused reservation, and detects provider overruns", () => {
    const reservation = reserveNarrationCall({ estimatedInputTokens: 1_000, maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS });
    const settled = settleCall({ reservation, actualUsage: { inputTokens: 900, outputTokens: 350 } });
    expect(settled).toMatchObject({ status: "settled", actualCostRub: "0.06000000", overrun: false });
    if (settled.status === "settled") expect(remainingBudget("10", settled.actualCostRub)).toBe("9.94000000");
    expect(settleCall({ reservation, actualUsage: { inputTokens: 1_000, outputTokens: 385 } })).toMatchObject({ status: "settled", overrun: true });
  });

  it("never treats missing usage as free", () => {
    const reservation = reserveNarrationCall({ estimatedInputTokens: 1, maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS });
    expect(settleCall({ reservation, actualUsage: undefined })).toEqual({ status: "usage_unavailable" });
  });
});
