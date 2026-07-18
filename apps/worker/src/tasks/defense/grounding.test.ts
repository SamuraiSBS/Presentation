import { describe, expect, it } from "vitest";
import { presentationSchema } from "@studydeck/shared";
import {
  applyDefenseGroundingToPresentation,
  assertDefensePresentation,
  buildDefenseGroundingBundle,
  buildDefenseNarrationText,
  defenseGroundingSource,
  prepareDefenseGenerationProject,
  type DefenseGroundingWorkspaceRow,
} from "./grounding.js";

const createdAt = new Date("2026-07-17T09:00:00.000Z");

describe("defense grounding", () => {
  it("passes only confirmed facts into the approved plan and applies assets, timing, style and placeholders", () => {
    const workspace = fixtureWorkspace();
    const bundle = buildDefenseGroundingBundle(workspace);
    expect(bundle.facts.map((fact) => fact.id)).toEqual(["fact-1"]);
    expect(bundle.plan.status).toBe("approved");

    const project = prepareDefenseGenerationProject({
      id: "project-1",
      title: "StudyDeck",
      prompt: "Подготовить защиту проекта",
      scenario: "project_defense",
      level: "student",
      mode: "fast_draft",
      slideCount: 10,
    }, bundle);
    expect(project.slideCount).toBe(4);
    expect(project.prompt).toContain("Используй только подтверждённые факты");

    const source = defenseGroundingSource(project.id, bundle);
    expect(source.excerpt).toContain("fact-1");
    expect(source.excerpt).not.toContain("Неподтверждённая гипотеза");
    expect(buildDefenseNarrationText(bundle)).toContain("Сценарий проверен на 12 пользователях");

    const grounded = applyDefenseGroundingToPresentation(fixturePresentation(), bundle, workspace.project.sources);
    expect(grounded.slides[0].placeholders).toHaveLength(1);
    expect(grounded.slides[1].timingSeconds).toBe(20);
    expect(grounded.slides[1].thesis).toBe("Сценарий проверен на 12 пользователях");
    expect(grounded.slides[1].sourceRefs[0]).toMatchObject({ sourceId: "source-spec", page: "стр. 2" });
    expect(grounded.slides[1].visual.image).toMatchObject({
      objectKey: "projects/project-1/screens/dashboard.png",
      provider: "user",
    });
    expect(grounded.presentationTheme?.colors.accent).toBe("#F97316");
    expect(() => assertDefensePresentation(grounded, bundle)).not.toThrow();
  });
});

function fixtureWorkspace(): DefenseGroundingWorkspaceRow {
  const slides = [
    { id: "plan-1", order: 1, title: "Паспорт проекта", purpose: "Представить автора и проект", placeholders: [{ id: "author-name", kind: "identity", label: "Укажите автора", resolved: false, severity: "error" }] },
    { id: "plan-2", order: 2, title: "Решение и результат", purpose: "Показать подтверждённый результат", placeholders: [] },
    { id: "plan-3", order: 3, title: "Архитектура решения", purpose: "Объяснить устройство проекта", placeholders: [] },
    { id: "plan-4", order: 4, title: "Итоги проекта", purpose: "Подвести итог защиты", placeholders: [] },
  ].map((slide) => ({
    ...slide,
    timingSeconds: 20,
    requirementIds: slide.order === 2 ? ["requirement-1"] : [],
    factIds: slide.order === 2 ? ["fact-1"] : [],
    assetSourceIds: slide.order === 2 ? ["source-screen"] : [],
    visualStrategy: "Структурная подача",
    origin: "user",
  }));
  return {
    defenseType: "hackathon",
    complianceMode: "strict",
    language: "ru",
    targetSlideCount: 4,
    targetDurationSeconds: 80,
    allowWebImages: false,
    authorProfile: {},
    standardPresetVersion: "hackathon-v1",
    analysisRevision: 2,
    planRevision: 3,
    styleBrief: {
      palette: { dominant: ["#F97316"] },
      fonts: {},
      logoSourceIds: [],
      motifs: [],
      tone: "light",
      visualDirection: "Тёплая технологичная подача",
      warnings: [],
    },
    plan: {
      version: 1,
      defenseType: "hackathon",
      complianceMode: "strict",
      presetVersion: null,
      status: "approved",
      slides,
      totalTimingSeconds: 80,
      approvedAt: "2026-07-17T09:05:00.000Z",
    },
    facts: [
      {
        id: "fact-1",
        key: "users",
        statement: "Сценарий проверен на 12 пользователях",
        value: 12,
        state: "active",
        evidence: [{ id: "evidence-1", confirmation: "source", sourceId: "source-spec", locator: "стр. 2", excerpt: "Проверено на 12 пользователях", confirmedById: null, createdAt }],
      },
      {
        id: "fact-guess",
        key: "guess",
        statement: "Неподтверждённая гипотеза",
        value: null,
        state: "active",
        evidence: [],
      },
    ],
    requirements: [{
      id: "requirement-1",
      key: "result",
      text: "Показать результат проекта",
      priority: "required",
      origin: "source",
      state: "active",
      sourceId: "source-spec",
      locator: "стр. 1",
      excerpt: "На защите показать результат",
      rule: { kind: "content_presence", target: "slides", phrase: "результат" },
      presetVersion: null,
    }],
    conflicts: [],
    project: {
      sources: [
        {
          id: "source-spec",
          label: "Техническое задание.pdf",
          role: "technical_spec",
          objectKey: "projects/project-1/spec.pdf",
          metadata: { origin: "upload", chunks: [], warnings: [] },
          included: true,
        },
        {
          id: "source-screen",
          label: "Панель проекта",
          role: "screenshot",
          objectKey: "projects/project-1/screens/dashboard.png",
          metadata: {
            origin: "upload",
            image: { width: 1440, height: 900, contentType: "image/png", byteSize: 1200 },
            chunks: [],
            warnings: [],
          },
          included: true,
        },
      ],
    },
  };
}

function fixturePresentation() {
  const titles = ["Черновик один", "Черновик два", "Черновик три", "Черновик четыре"];
  return presentationSchema.parse({
    id: "presentation-1",
    title: "StudyDeck",
    scenario: "project_defense",
    level: "student",
    slideCount: 4,
    generationMode: "demo",
    generatedText: "Черновик речи",
    sources: [],
    outline: titles,
    narrativePlan: [],
    speechScript: titles.map((title, index) => ({ slideOrder: index + 1, slideTitle: title, text: `Речь для раздела ${index + 1}.` })),
    slides: titles.map((title, index) => ({
      id: `slide-${index + 1}`,
      order: index + 1,
      title,
      layout: index === 0 ? "hero" : index === 3 ? "summary" : "bullets",
      thesis: `Содержание раздела ${index + 1}`,
      blocks: [{ type: "callout", content: `Содержание раздела ${index + 1}` }],
      speakerNotes: `Речь для раздела ${index + 1}.`,
      timingSeconds: 30,
      sourceRefs: [],
    })),
  });
}
