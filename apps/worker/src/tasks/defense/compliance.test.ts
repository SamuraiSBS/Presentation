import { describe, expect, it } from "vitest";
import {
  complianceReportDocumentSchema,
  defensePlanSchema,
  presentationSchema,
  projectRequirementSchema,
} from "@studydeck/shared";
import { buildDeterministicComplianceReport } from "./compliance.js";

describe("defense compliance", () => {
  it("keeps deterministic failures and reports timing overloads", () => {
    const presentation = presentationSchema.parse({
      id: "deck-1",
      title: "Проект",
      scenario: "university_report",
      level: "university_student",
      slideCount: 4,
      generationMode: "demo",
      generatedText: "Слайд 1: Проект",
      sources: [],
      outline: ["Проект", "Проблема", "Решение", "Итог"],
      speechScript: [1, 2, 3, 4].map((order) => ({ slideId: `slide-${order}`, slideOrder: order, slideTitle: `Слайд ${order}`, text: "Подробный текст выступления." })),
      slides: [1, 2, 3, 4].map((order) => ({
        id: `slide-${order}`,
        order,
        title: order === 1 ? "Проект" : `Слайд ${order}`,
        slideKind: order === 1 ? "title" : order === 4 ? "summary" : "content",
        layout: order === 1 ? "hero" : order === 4 ? "summary" : "statement",
        thesis: "Подтверждённый тезис",
        bullets: [],
        definition: null,
        keyConcepts: [],
        visual: { type: "none", description: "" },
        highlights: [],
        blocks: [{ type: "callout", content: "Подтверждённый тезис" }],
        speakerNotes: "Очень ".repeat(80),
        timingSeconds: 20,
        sourceRefs: [],
        placeholders: [],
      })),
    });
    const plan = defensePlanSchema.parse({
      version: 1,
      defenseType: "hackathon",
      complianceMode: "strict",
      presetVersion: "hackathon-v1",
      status: "approved",
      slides: [1, 2, 3, 4].map((order) => ({ id: `plan-${order}`, order, title: `Слайд ${order}`, purpose: "Цель", timingSeconds: 20, requirementIds: [], factIds: [], assetSourceIds: [], placeholders: [], visualStrategy: "", origin: "user" })),
      totalTimingSeconds: 80,
      approvedAt: new Date().toISOString(),
    });
    const requirement = projectRequirementSchema.parse({ id: "req-count", key: "count", text: "Нужно 5 слайдов", priority: "required", origin: "user", state: "active", rule: { kind: "slide_count", exact: 5 } });
    const report = buildDeterministicComplianceReport({
      reportId: "report-1",
      workspaceId: "workspace-1",
      presentationRevision: 1,
      analysisRevision: 1,
      planRevision: 1,
      presentation,
      plan,
      authorProfile: {},
      requirements: [requirement],
      facts: [],
      conflicts: [],
      assets: [],
    });

    expect(report.items[0]).toMatchObject({ result: "unsatisfied", deterministicResult: "unsatisfied" });
    expect(report.counts.required.unsatisfied).toBe(1);
    expect(report.timingOverloads).toHaveLength(4);
    expect(complianceReportDocumentSchema.parse(report)).toEqual(report);
  });
});
