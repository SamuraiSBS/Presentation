import { describe, expect, it } from "vitest";
import { aitunnelReportedCostRub } from "./provider-cost.js";

describe("AITUNNEL provider cost", () => {
  it("prefers a cost-rub header and accepts the documented usage.cost_rub fallback", () => {
    expect(aitunnelReportedCostRub({ usage: { cost_rub: 0.5 } }, new Headers({ "cost-rub": "0.125" }))).toBe("0.12500000");
    expect(aitunnelReportedCostRub({ usage: { cost_rub: "0.5" } }, new Headers())).toBe("0.50000000");
    expect(aitunnelReportedCostRub({ usage: {} }, new Headers())).toBeUndefined();
  });
});
