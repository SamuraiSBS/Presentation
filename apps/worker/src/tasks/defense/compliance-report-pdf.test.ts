import { describe, expect, it } from "vitest";
import { renderComplianceReportHtml } from "./compliance-report-pdf.js";

describe("compliance report HTML", () => {
  it("escapes user-controlled report text", () => {
    const html = renderComplianceReportHtml({
      schemaVersion: 1,
      reportId: "report-1",
      workspaceId: "workspace-1",
      presentationRevision: 1,
      analysisRevision: 1,
      planRevision: 1,
      checkedAt: new Date().toISOString(),
      semanticStatus: "not_run",
      counts: {
        required: { total: 1, satisfied: 0, partial: 0, unsatisfied: 1, ignored: 0, needsReview: 0 },
        recommended: { total: 0, satisfied: 0, partial: 0, unsatisfied: 0, ignored: 0, needsReview: 0 },
        preference: { total: 0, satisfied: 0, partial: 0, unsatisfied: 0, ignored: 0, needsReview: 0 },
      },
      items: [{ id: "item-1", checkKey: "<script>alert(1)</script>", priority: "required", result: "unsatisfied", deterministicResult: "unsatisfied", reason: "Нет", evidence: [] }],
      placeholders: [], conflicts: [], factProvenance: [], imageProvenance: [], timingOverloads: [],
      diff: { fixedRequirementIds: [], regressedRequirementIds: [], newPlaceholderIds: [], resolvedPlaceholderIds: [] },
      warnings: [],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
