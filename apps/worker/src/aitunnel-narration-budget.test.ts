import { describe, expect, it } from "vitest";
import {
  AITUNNEL_NARRATION_DEFAULT_MAX_OUTPUT_TOKENS,
  aitunnelNarrationBudgetConfig,
  canStartCall,
  estimateInputTokens,
  remainingBudget,
  reserveNarrationCall,
  settleCall,
} from "./aitunnel-narration-budget.js";

describe("AITUNNEL narration budget", () => {
  it("uses bounded defaults when environment values are absent or invalid", () => {
    expect(aitunnelNarrationBudgetConfig({})).toEqual({ budgetRub: "20", maxOutputTokens: 2400, reasoningEffort: "minimal" });
    expect(aitunnelNarrationBudgetConfig({
      AITUNNEL_NARRATION_JOB_BUDGET_RUB: "0",
      AITUNNEL_NARRATION_MAX_OUTPUT_TOKENS: "-1",
      AITUNNEL_NARRATION_REASONING_EFFORT: "unlimited",
    })).toEqual({ budgetRub: "20", maxOutputTokens: AITUNNEL_NARRATION_DEFAULT_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" });
  });

  it("reserves conservative serialized input plus the entire output cap without float drift", () => {
    const estimate = estimateInputTokens({ input: "Пример запроса" });
    expect(estimate).toBeGreaterThan(0);
    const reservation = reserveNarrationCall({ estimatedInputTokens: 932, maxOutputTokens: 2400 });
    expect(reservation.costRub).toBe("5.88406000");
    expect(canStartCall({ remainingBudgetRub: "5.88406000", reservation })).toBe(true);
    expect(canStartCall({ remainingBudgetRub: "5.88405999", reservation })).toBe(false);
  });

  it("settles actual usage, returns unused reservation, and detects provider overruns", () => {
    const reservation = reserveNarrationCall({ estimatedInputTokens: 1_000, maxOutputTokens: 2_400 });
    const settled = settleCall({ reservation, actualUsage: { inputTokens: 900, outputTokens: 2_000 } });
    expect(settled).toMatchObject({ status: "settled", actualCostRub: "4.95950000", overrun: false });
    if (settled.status === "settled") expect(remainingBudget("20", settled.actualCostRub)).toBe("15.04050000");
    expect(settleCall({ reservation, actualUsage: { inputTokens: 1_000, outputTokens: 2_401 } })).toMatchObject({ status: "settled", overrun: true });
  });

  it("never treats missing usage as free", () => {
    const reservation = reserveNarrationCall({ estimatedInputTokens: 1, maxOutputTokens: 2400 });
    expect(settleCall({ reservation, actualUsage: undefined })).toEqual({ status: "usage_unavailable" });
  });
});
