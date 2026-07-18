import { describe, expect, it } from "vitest";
import {
  addDefenseRepositoryInputSchema,
  buildAuthorPlaceholders,
  complianceReportDocumentSchema,
  contentPlaceholderSchema,
  createDefenseProjectInputSchema,
  createExportInputSchema,
  defenseConfigSchema,
  defenseGroundingBundleSchema,
  defensePresetSchema,
  defenseUploadManifestSchema,
  exportWarningAcknowledgementSchema,
  factEvidenceSchema,
  generationJobKindSchema,
  generationProgressStageSchema,
  getDefensePreset,
  materializeDefensePresetRequirements,
  patchDefenseConfigInputSchema,
  presentationSchema,
  projectFactSchema,
  projectRequirementSchema,
  requirementRuleSchema,
  resolveConflictInputSchema,
  startComplianceCheckInputSchema,
  startDefenseAnalysisInputSchema,
} from "../index.js";

describe("requirements-driven defense contracts", () => {
  it("enforces defense config limits and matching versioned presets", () => {
    const parsed = defenseConfigSchema.parse({
      defenseType: "hackathon",
      complianceMode: "strict",
      targetSlideCount: 10,
      targetDurationSeconds: 420,
      standardPresetVersion: "hackathon-v1",
    });

    expect(parsed.language).toBe("ru");
    expect(parsed.allowWebImages).toBe(false);
    expect(parsed.authorProfile).toEqual({});
    expect(() => defenseConfigSchema.parse({ ...parsed, targetSlideCount: 21 })).toThrow();
    expect(() => defenseConfigSchema.parse({ ...parsed, targetDurationSeconds: 901 })).toThrow();
    expect(() => defenseConfigSchema.parse({ ...parsed, standardPresetVersion: "diploma-v1" })).toThrow(
      /match defenseType/,
    );
    expect(() => defenseConfigSchema.parse({ ...parsed, language: "en" })).toThrow();
  });

  it("builds deterministic author placeholders without inventing identity fields", () => {
    const diplomaPlaceholders = buildAuthorPlaceholders("diploma", {
      fullName: "Иван Иванов",
      year: "2026",
    });
    const hackathonPlaceholders = buildAuthorPlaceholders("hackathon", {});

    expect(diplomaPlaceholders.map((placeholder) => placeholder.id)).toEqual([
      "author-institution",
      "author-department",
      "author-group",
      "author-supervisor",
      "author-city",
    ]);
    expect(diplomaPlaceholders.every((placeholder) => placeholder.kind === "identity" && !placeholder.resolved)).toBe(true);
    expect(hackathonPlaceholders.map((placeholder) => placeholder.id)).toEqual([
      "author-fullName",
      "author-teamName",
      "author-eventName",
    ]);
  });

  it("strictly parses defense API inputs and repository/upload boundaries", () => {
    expect(
      createDefenseProjectInputSchema.parse({
        title: "Защита проекта",
        defenseType: "diploma",
        complianceMode: "adaptive",
        targetSlideCount: 12,
        targetDurationSeconds: 600,
        idempotencyKey: "create-defense-123",
      }),
    ).toMatchObject({ allowWebImages: false, authorProfile: {} });
    expect(() =>
      createDefenseProjectInputSchema.parse({
        title: "Защита проекта",
        defenseType: "diploma",
        complianceMode: "adaptive",
        targetSlideCount: 12,
        targetDurationSeconds: 600,
        unexpected: true,
      }),
    ).toThrow();

    expect(addDefenseRepositoryInputSchema.parse({ url: "https://github.com/studydeck/example" }).url).toContain(
      "github.com",
    );
    expect(() => addDefenseRepositoryInputSchema.parse({ url: "http://github.com/studydeck/example" })).toThrow();
    expect(() => addDefenseRepositoryInputSchema.parse({ url: "https://example.com/studydeck/example" })).toThrow();
    expect(() => addDefenseRepositoryInputSchema.parse({ url: "https://user@github.com/studydeck/example" })).toThrow();

    expect(
      defenseUploadManifestSchema.parse({
        files: [
          { fieldName: "project", role: "project_document" },
          { fieldName: "screen_1", role: "screenshot" },
        ],
      }).files,
    ).toHaveLength(2);
    expect(() =>
      defenseUploadManifestSchema.parse({
        files: [
          { fieldName: "same", role: "project_document" },
          { fieldName: "same", role: "technical_spec" },
        ],
      }),
    ).toThrow(/unique/);
    expect(() => defenseUploadManifestSchema.parse({ files: [{ fieldName: "web", role: "web_image" }] })).toThrow();

    expect(() => patchDefenseConfigInputSchema.parse({ defenseType: "hackathon" })).toThrow(/confirmation/);
    expect(
      patchDefenseConfigInputSchema.parse({ defenseType: "hackathon", confirmPresetRebuild: true }).defenseType,
    ).toBe("hackathon");
    expect(() => patchDefenseConfigInputSchema.parse({})).toThrow(/At least one/);
    expect(() => startDefenseAnalysisInputSchema.parse({ confirmCost: false })).toThrow();
    expect(startDefenseAnalysisInputSchema.parse({ confirmCost: true })).toEqual({ confirmCost: true });
  });

  it("requires evidence for every fact and validates evidence provenance", () => {
    expect(() =>
      projectFactSchema.parse({ id: "fact-1", statement: "Проект использует PostgreSQL", evidence: [] }),
    ).toThrow();
    expect(() => factEvidenceSchema.parse({ confirmation: "source" })).toThrow(/sourceId/);
    expect(() => factEvidenceSchema.parse({ confirmation: "source", sourceId: "source-1" })).toThrow(/locator/);
    expect(() => factEvidenceSchema.parse({ confirmation: "user", sourceId: "source-1" })).toThrow(/impersonate/);

    const fact = projectFactSchema.parse({
      id: "fact-1",
      statement: "Проект использует PostgreSQL",
      evidence: [{ confirmation: "source", sourceId: "source-1", locator: "README#stack" }],
    });
    expect(fact.state).toBe("active");
    expect(fact.evidence[0].sourceId).toBe("source-1");
  });

  it("strictly validates structured requirement rules and conflict resolutions", () => {
    expect(requirementRuleSchema.parse({ kind: "slide_count", exact: 10 })).toEqual({
      kind: "slide_count",
      exact: 10,
    });
    expect(() => requirementRuleSchema.parse({ kind: "slide_count" })).toThrow();
    expect(() =>
      requirementRuleSchema.parse({ kind: "slide_position", position: "first", order: 1 }),
    ).toThrow(/Only exact/);
    expect(() =>
      projectRequirementSchema.parse({
        id: "requirement-1",
        text: "Первый слайд — титульный",
        priority: "required",
        origin: "builtin",
      }),
    ).toThrow(/presetVersion/);
    expect(() => resolveConflictInputSchema.parse({ action: "resolve" })).toThrow(/resolution/);
    expect(resolveConflictInputSchema.parse({ action: "ignore" })).toEqual({ action: "ignore" });
  });

  it("keeps both built-in presets deterministic, versioned, and mutation-isolated", () => {
    const firstHackathon = getDefensePreset("hackathon");
    const secondHackathon = getDefensePreset("hackathon-v1");
    const diploma = getDefensePreset("diploma");

    expect(firstHackathon).toEqual(secondHackathon);
    expect(firstHackathon).not.toBe(secondHackathon);
    expect(firstHackathon.version).toBe("hackathon-v1");
    expect(firstHackathon.slides).toHaveLength(10);
    expect(firstHackathon.targetDurationSeconds).toBe(420);
    expect(firstHackathon.slides.reduce((total, slide) => total + slide.timingSeconds, 0)).toBe(420);
    expect(diploma.version).toBe("diploma-v1");
    expect(diploma.slides).toHaveLength(12);
    expect(diploma.targetDurationSeconds).toBe(600);
    expect(diploma.slides.reduce((total, slide) => total + slide.timingSeconds, 0)).toBe(600);
    expect(() => defensePresetSchema.parse({ ...firstHackathon, version: "diploma-v1" })).toThrow();

    firstHackathon.slides[0].title = "Изменено локально";
    expect(getDefensePreset("hackathon").slides[0].title).toBe("Название проекта и команда");

    const materialized = materializeDefensePresetRequirements("diploma-v1");
    expect(materialized.every((requirement) => requirement.origin === "builtin")).toBe(true);
    expect(materialized.every((requirement) => requirement.presetVersion === "diploma-v1")).toBe(true);
    expect(new Set(materialized.map((requirement) => requirement.id)).size).toBe(materialized.length);
  });

  it("keeps old presentation documents valid and defaults structured placeholders", () => {
    const parsed = presentationSchema.parse({
      id: "legacy-presentation",
      title: "Старая презентация",
      scenario: "project_defense",
      level: "university_student",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Введение"],
      speechScript: [{ slideOrder: 1, slideTitle: "Введение", text: "Текст выступления." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Введение",
          layout: "hero",
          blocks: [],
          speakerNotes: "Текст выступления.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(parsed.slides[0].placeholders).toEqual([]);
  });

  it("round-trips structured placeholders through presentation documents", () => {
    const placeholder = contentPlaceholderSchema.parse({
      id: "placeholder-screen",
      requirementId: "requirement-screen",
      kind: "screenshot",
      label: "Добавьте скриншот главного экрана",
      severity: "error",
    });
    const parsed = presentationSchema.parse({
      id: "defense-presentation",
      title: "Защита проекта",
      scenario: "project_defense",
      level: "university_student",
      slideCount: 1,
      generationMode: "demo",
      sources: [],
      outline: ["Интерфейс"],
      speechScript: [{ slideOrder: 1, slideTitle: "Интерфейс", text: "Покажем интерфейс проекта." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Интерфейс",
          layout: "image-focus",
          blocks: [],
          placeholders: [placeholder],
          speakerNotes: "Покажем интерфейс проекта.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    expect(parsed.slides[0].placeholders).toEqual([placeholder]);
    expect(() =>
      contentPlaceholderSchema.parse({
        ...placeholder,
        resolved: true,
      }),
    ).toThrow(/resolvedAt/);
  });

  it("validates grounding references and accepts only approved factual bundles", () => {
    const approvedAt = "2026-07-17T12:00:00.000Z";
    const config = defenseConfigSchema.parse({
      defenseType: "hackathon",
      complianceMode: "strict",
      targetSlideCount: 4,
      targetDurationSeconds: 120,
      standardPresetVersion: "hackathon-v1",
    });
    const plan = {
      defenseType: "hackathon" as const,
      complianceMode: "strict" as const,
      presetVersion: "hackathon-v1" as const,
      status: "approved" as const,
      totalTimingSeconds: 120,
      approvedAt,
      slides: Array.from({ length: 4 }, (_, index) => ({
        id: `plan-${index + 1}`,
        order: index + 1,
        title: `Раздел ${index + 1}`,
        purpose: "Раскрыть подтверждённую часть проекта.",
        timingSeconds: 30,
        requirementIds: index === 0 ? ["requirement-1"] : [],
        factIds: index === 0 ? ["fact-1"] : [],
        assetSourceIds: [],
        origin: "user" as const,
      })),
    };
    const bundle = defenseGroundingBundleSchema.parse({
      analysisRevision: 1,
      planRevision: 1,
      config,
      facts: [
        {
          id: "fact-1",
          statement: "Проект существует",
          evidence: [{ confirmation: "user", confirmedAt: approvedAt }],
        },
      ],
      requirements: [
        {
          id: "requirement-1",
          text: "Показать проект",
          priority: "required",
          origin: "user",
        },
      ],
      plan,
    });

    expect(bundle.facts[0].evidence).toHaveLength(1);
    expect(() =>
      defenseGroundingBundleSchema.parse({
        ...bundle,
        plan: {
          ...bundle.plan,
          slides: bundle.plan.slides.map((slide, index) =>
            index === 0 ? { ...slide, factIds: ["missing-fact"] } : slide,
          ),
        },
      }),
    ).toThrow(/Unknown or inactive fact/);
  });

  it("validates versioned compliance reports and keeps priority totals separate", () => {
    const document = complianceReportDocumentSchema.parse({
      reportId: "report-1",
      workspaceId: "workspace-1",
      presentationRevision: 3,
      analysisRevision: 2,
      planRevision: 1,
      checkedAt: "2026-07-17T12:00:00.000Z",
      semanticStatus: "complete",
      counts: {
        required: { total: 1, satisfied: 0, partial: 0, unsatisfied: 1, ignored: 0, needsReview: 0 },
        recommended: { total: 1, satisfied: 1, partial: 0, unsatisfied: 0, ignored: 0, needsReview: 0 },
        preference: { total: 0, satisfied: 0, partial: 0, unsatisfied: 0, ignored: 0, needsReview: 0 },
      },
      items: [
        {
          id: "item-required",
          checkKey: "required-screenshot",
          requirementId: "requirement-1",
          priority: "required",
          result: "unsatisfied",
          deterministicResult: "unsatisfied",
          semanticResult: "satisfied",
          reason: "Нет пользовательского скриншота.",
          evidence: [
            {
              slideId: "slide-1",
              slideOrder: 1,
              matchedTextFragment: "Добавьте скриншот",
              requirementIds: ["requirement-1"],
            },
          ],
        },
        {
          id: "item-recommended",
          checkKey: "recommended-notes",
          requirementId: "requirement-2",
          priority: "recommended",
          result: "satisfied",
          semanticResult: "satisfied",
          reason: "Текст выступления присутствует.",
          evidence: [{ slideId: "slide-1", slideOrder: 1, matchedTextFragment: "Текст выступления" }],
        },
      ],
      placeholders: [
        {
          id: "placeholder-screen",
          requirementId: "requirement-1",
          kind: "screenshot",
          label: "Добавьте скриншот",
          severity: "error",
        },
      ],
      timingOverloads: [
        {
          slideId: "slide-1",
          slideOrder: 1,
          allocatedSeconds: 30,
          estimatedSeconds: 40,
          overflowSeconds: 10,
        },
      ],
    });

    expect(document.schemaVersion).toBe(1);
    expect(document.counts.required.unsatisfied).toBe(1);
    expect(document.diff).toEqual({
      fixedRequirementIds: [],
      regressedRequirementIds: [],
      newPlaceholderIds: [],
      resolvedPlaceholderIds: [],
    });
    expect(() =>
      complianceReportDocumentSchema.parse({
        ...document,
        counts: {
          ...document.counts,
          required: { ...document.counts.required, total: 2 },
        },
      }),
    ).toThrow(/add up/);
    expect(() =>
      complianceReportDocumentSchema.parse({
        ...document,
        items: [{ ...document.items[0], result: "satisfied" }],
      }),
    ).toThrow(/cannot override/);
  });

  it("requires backend-verifiable export acknowledgement for warning overrides", () => {
    expect(exportWarningAcknowledgementSchema.parse({})).toEqual({ acknowledgeWarnings: false });
    expect(() =>
      exportWarningAcknowledgementSchema.parse({
        acknowledgeWarnings: true,
        expectedPresentationRevision: 3,
      }),
    ).toThrow(/report ID or preflight token/);
    expect(
      createExportInputSchema.parse({
        type: "pptx",
        acknowledgement: {
          acknowledgeWarnings: true,
          preflightToken: "preflight-token-that-is-long-enough",
          expectedPresentationRevision: 3,
        },
      }).acknowledgement?.acknowledgeWarnings,
    ).toBe(true);
  });

  it("exposes typed defense jobs, stages, and revision-bound compliance input", () => {
    expect(generationJobKindSchema.parse("requirements_analysis")).toBe("requirements_analysis");
    expect(generationJobKindSchema.parse("compliance")).toBe("compliance");
    for (const stage of [
      "extracting_sources",
      "extracting_requirements",
      "classifying_assets",
      "building_defense_plan",
      "checking_compliance",
      "saving_report",
    ]) {
      expect(generationProgressStageSchema.parse(stage)).toBe(stage);
    }
    expect(
      startComplianceCheckInputSchema.parse({
        expectedPresentationRevision: 3,
        expectedAnalysisRevision: 2,
        expectedPlanRevision: 1,
      }),
    ).toEqual({ expectedPresentationRevision: 3, expectedAnalysisRevision: 2, expectedPlanRevision: 1 });
  });
});
