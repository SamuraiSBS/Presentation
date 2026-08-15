import { describe, expect, it } from "vitest";
import { defenseAnalysisPlanJobSpec } from "./defense-analysis-plan-job.js";

describe("defense analysis and plan job specs", () => {
  it("keeps analysis retries stable and distinguishes plan revisions", () => {
    const analysis = defenseAnalysisPlanJobSpec({ scope: "analysis", workspaceId: "workspace-1", analysisRevision: 3, planRevision: 7 });
    const plan = defenseAnalysisPlanJobSpec({ scope: "plan", workspaceId: "workspace-1", analysisRevision: 3, planRevision: 7 });
    expect(analysis.requestKey).toBe("defense:analysis:workspace-1:3:auto");
    expect(plan.requestKey).toBe("defense:plan:workspace-1:3:7");
    expect(analysis.progressStage).toBe("extracting_sources");
    expect(plan.progressStage).toBe("building_defense_plan");
  });
});
