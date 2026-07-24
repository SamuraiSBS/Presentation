import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { auditSlideCanvas, presentationSchema } from "@studydeck/shared";
import {
  buildGenerationPrompt,
  buildSafePresentationFromNarration,
  findSlideTextIssues,
  generateNarrationDraft,
  generatePresentation,
  generatePresentationFromNarration,
  generateStructuredWithProvider,
  inferContentLayout,
  normalizeLayout,
  normalizeNarrativePlan,
  selectAiProviders,
} from "./presentation.js";
import { generatePresentation as generatePresentationFromOrchestrator, generatePresentationFromNarrationWithProviders } from "./presentation/orchestrator.js";
import { buildGenerationPrompt as buildGenerationPromptFromLayer } from "./presentation/prompts/builders.js";
import { buildAitunnelFullNarrationRewritePrompt, buildFullNarrationDurationRewritePrompt, buildNarrationPrompt, buildNarrativePlanPrompt } from "./presentation/prompts/builders.js";
import { buildFallbackNarrativeItem, normalizeNarrativePlan as normalizeNarrativePlanFromLayer } from "./presentation/planning/builders.js";
import { classifyAitunnelNarrationRewriteFailure, generateAitunnelNarration, generateYandexNarration, MAX_AITUNNEL_NARRATION_TEXT_CALLS, MAX_YANDEX_NARRATION_TEXT_CALLS, isRecoverableYandexStructuredPresentationError, presentationRecoveryChunks, StructuredGenerationError } from "./presentation/providers/generation.js";
import { AitunnelProjectBudget, estimateInputTokens, runWithAitunnelProjectBudget } from "../aitunnel-narration-budget.js";
import { NARRATION_SYSTEM_PROMPT } from "./presentation/constants.js";
import { sourceEvidenceForSlide } from "./presentation/planning/builders.js";
import { findSlideTextIssues as findSlideTextIssuesFromLayer } from "./presentation/quality/orchestration.js";
import { applyNarrationFallbacks } from "./presentation/quality/orchestration.js";
import { looksLikeSentenceFragment } from "./presentation/quality/orchestration.js";
import { normalizeLayout as normalizeLayoutFromLayer, normalizeVisual } from "./presentation/normalization/presentation.js";
import { findSpokenNarrationIssues, normalizeNarrationText, parseNarrationSections, validateNarrationSections, yandexNarrationCompletionTelemetry } from "./presentation/narration/processing.js";
import { shortenSentence } from "./presentation/utilities.js";

const originalEnv = { ...process.env };
const forbiddenNarrationFragments = [
  'Слайд "',
  "объясняет часть темы",
  "опорные пункты",
  "Затем стоит показать связь",
  "После этого можно закрепить",
  "основной смысл раскрывается",
  "рассказе про",
  "Примеры. Поэтому",
  "Так становится понятнее, почему тема",
  "важна именно в этой части рассказа",
  "Связь с разделом",
  "помогает слушателю увидеть не только событие",
  "увидеть не только событие, но и его значение",
  "Без этого уточнения дальнейший вывод",
  "Дальше раздел",
  "продолжает тему",
  "Сначала важно удержать конкретную мысль",
  "Следующая деталь добавляет к объяснению",
  "новый шаг",
  "Этот шаг подводит рассказ",
  "к следующей части",
  "оставляет место для следующей мысли",
  "готовит переход дальше",
  "Это проявляется в том, что",
  "Причина такого вывода в том",
  "Последствия заметны там, где",
  "поэтому итог звучит так",
  "становится главным итогом выступления",
  "Главная мысль",
  "общая мысль",
  "Пример нужен",
  "вся история темы",
  "текст на слайде",
  "следующий раздел",
  "следующая часть",
  "переход к следующему",
];
const forbiddenSlideTextFragments = [
  "Подготовь академическую",
  "легкую для устного выступления",
  "студенческую презентацию",
  "Связи:",
  "требует осторожных формулировок",
  "лучше объяснять через проверяемые причины",
  "Главная идея связана с темой",
  "Материал стоит разбирать",
  "смысловым частым",
  "смысловым частям",
  "Ключевые понятия помогают удержать структуру",
  "Пример или визуальная схема",
  "На слайде показано",
  "Этот слайд помогает",
  "Этот раздел объясняет",
  "Здесь собраны основные факты",
  "на картинке",
  "на изображении",
  "как показано на картинке",
];

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("presentation compatibility facade", () => {
  it("normalizes harmless provider visual aliases and drops unknown visual types", () => {
    const project = { id: "saturn", title: "Сатурн", prompt: "Планета Сатурн", scenario: "lesson", level: "university_student", mode: "with_sources", slideCount: 10 };
    const diagram = normalizeVisual({ type: "diagram", items: [{ label: "Кольца", text: "Кольца состоят из множества частиц." }, { label: "Орбита", text: "Частицы движутся вокруг планеты." }] }, "Кольца Сатурна", "Кольца образуют сложную систему.", ["Частицы движутся по орбитам."], "content", project, 2);
    const unknown = normalizeVisual({ type: "provider_magic", items: [{ label: "Нельзя", text: "сохранять" }] }, "Сатурн", "Сатурн — газовый гигант.", [], "content", project, 2);

    expect(diagram.type).toBe("process_diagram");
    expect(unknown).toMatchObject({ type: "none", items: [], rows: [] });
    expect(unknown).not.toHaveProperty("image");
  });

  it("builds a local deck from accepted narration without a configured AI provider", () => {
    const acceptedNarration = [
      "Слайд 1: Введение",
      "Согласованный текст выступления остаётся основой презентации и не меняется во время локального восстановления. Он фиксирует объяснение решения, причины выбранного подхода, ожидаемый результат и практическую ценность готовой презентации для аудитории.",
      "",
      "Слайд 2: Итог",
      "Локальная сборка позволяет завершить презентацию даже при недоступности внешнего провайдера. Пользователь получает готовый документ без повторного согласования текста выступления, сохраняет структуру доклада и может сразу перейти к редактированию слайдов.",
    ].join("\n");
    const presentation = buildSafePresentationFromNarration({
      id: "accepted-narration-safe-deck",
      title: "Надёжная генерация",
      prompt: "Подготовь презентацию о надёжной генерации",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount: 2,
    }, [], acceptedNarration);

    expect(presentation.generationMode).toBe("demo-fallback");
    expect(presentation.generatedText).toBe(acceptedNarration);
    expect(presentation.speechScript.map((item) => item.text)).toEqual([
      "Согласованный текст выступления остаётся основой презентации и не меняется во время локального восстановления. Он фиксирует объяснение решения, причины выбранного подхода, ожидаемый результат и практическую ценность готовой презентации для аудитории.",
      "Локальная сборка позволяет завершить презентацию даже при недоступности внешнего провайдера. Пользователь получает готовый документ без повторного согласования текста выступления, сохраняет структуру доклада и может сразу перейти к редактированию слайдов.",
    ]);
    expect(presentation.slides.flatMap((slide) => slide.canvas ? [] : [slide.order])).toEqual([]);
  });

  it("makes the speech-duration budget quality-first rather than a padding target", () => {
    expect(NARRATION_SYSTEM_PROMPT).toContain("quality-first range");
    expect(NARRATION_SYSTEM_PROMPT).toContain("never pad");
    expect(NARRATION_SYSTEM_PROMPT).not.toContain("hard contract");
  });

  it("rejects a short narration instead of locally extending it from the narrative plan", () => {
    const project = { id: "project", title: "Тема", prompt: "Подготовь университетскую презентацию о теме", scenario: "report", level: "university_student", mode: "create", slideCount: 10 };
    const shortNarration = Array.from({ length: 10 }, (_, index) => {
      const order = index + 1;
      return `Слайд ${order}: Раздел ${order}\n${Array.from({ length: 60 }, (_, word) => `слово${order}_${word + 1}`).join(" ")}.`;
    }).join("\n\n");
    const plan = Array.from({ length: 10 }, (_, index) => ({
      slideOrder: index + 1,
      slideTitle: `Раздел ${index + 1}`,
      slidePurpose: `объяснить аспект ${index + 1}`,
      keyMessage: `ключевой тезис ${index + 1} подтверждается фактами`,
      audienceQuestion: `какую роль играет аспект ${index + 1}`,
      transitionToNext: "",
      evidenceOrExplanation: `конкретное объяснение аспекта ${index + 1}`,
      whyItMatters: `это меняет понимание аспекта ${index + 1}`,
    }));

    expect(() => normalizeNarrationText(shortNarration, project)).toThrow("duration is below");
    expect(shortNarration).not.toContain(";");
    expect(plan.some((item) => shortNarration.includes(item.slidePurpose) || shortNarration.includes(item.audienceQuestion))).toBe(false);
  });

  it.each([6, 8, 10, 12, 14])("keeps short narrations invalid for a %i-slide timing contract", (slideCount) => {
    const project = { id: "project", title: "Тема", prompt: "Подготовь университетскую презентацию о теме", scenario: "report", level: "university_student", mode: "create", slideCount };
    const shortNarration = Array.from({ length: slideCount }, (_, index) => `Слайд ${index + 1}: Раздел ${index + 1}\n${Array.from({ length: 60 }, (_, word) => `слово${index + 1}_${word + 1}`).join(" ")}.`).join("\n\n");
    const plan = Array.from({ length: slideCount }, (_, index) => ({
      slideOrder: index + 1,
      slideTitle: `Раздел ${index + 1}`,
      slidePurpose: `объяснить аспект ${index + 1}`,
      keyMessage: `ключевой тезис ${index + 1} подтверждается фактами`,
      audienceQuestion: `какую роль играет аспект ${index + 1}`,
      transitionToNext: "",
      evidenceOrExplanation: `конкретное объяснение аспекта ${index + 1}`,
      whyItMatters: `это меняет понимание аспекта ${index + 1}`,
    }));
    expect(() => normalizeNarrationText(shortNarration, project)).toThrow("duration is below");
    expect(plan.some((item) => shortNarration.includes(item.slidePurpose) || shortNarration.includes(item.audienceQuestion))).toBe(false);
  });

  it("keeps template narration blocked instead of replacing it locally from the narrative plan", () => {
    const project = {
      id: "saturn-template-repair",
      title: "Система Сатурна",
      prompt: "Подготовь учебную презентацию о системе Сатурна",
      scenario: "lesson",
      level: "school",
      mode: "create",
      slideCount: 10,
    } as const;
    const finalPlan = buildFallbackNarrativeItem(project, 10);
    expect(finalPlan.slidePurpose).not.toContain("Собрать ответ на главный вопрос");
    expect(finalPlan.slidePurpose).not.toContain("оставить 2–3");

    const narration = Array.from({ length: 10 }, (_, index) => {
      const order = index + 1;
      const text = order === 10
        ? "Собрать ответ на главный вопрос темы «Система Сатурна», связать его с предыдущими смысловыми шагами и оставить 2–3 разных подтвержденных вывода. Строение, кольца и спутники раскрывают разные стороны системы Сатурна без добавления новых фактов для учебного объяснения."
        : `Наблюдение ${order} связывает выбранный аспект с системой Сатурна и объясняет его место в общей картине. Различие ${order} сохраняет последовательность наблюдений и делает ход учебного объяснения яснее.`;
      return `Слайд ${order}: Раздел ${order}\n${text}`;
    }).join("\n\n");
    const plan = Array.from({ length: 10 }, (_, index) => ({
      slideOrder: index + 1,
      slideTitle: `Раздел ${index + 1}`,
      slidePurpose: index === 9 ? finalPlan.slidePurpose : `Рассмотреть аспект ${index + 1} системы Сатурна.`,
      keyMessage: index === 9 ? finalPlan.keyMessage : `Аспект ${index + 1} раскрывает выбранную сторону системы Сатурна.`,
      audienceQuestion: "",
      transitionToNext: "",
      evidenceOrExplanation: index === 9 ? "Строение, кольца и спутники вместе показывают научную ценность системы Сатурна." : "",
      whyItMatters: index === 9 ? "Строение, кольца и спутники вместе показывают научную ценность системы Сатурна." : "",
    }));

    const templateOnlyNarration = narration.replace(" Строение, кольца и спутники раскрывают разные стороны системы Сатурна без добавления новых фактов для учебного объяснения.", "");
    expect(validateNarrationSections(parseNarrationSections(templateOnlyNarration), project).some((issue) => issue.includes("contains template narration"))).toBe(true);
    expect(validateNarrationSections(parseNarrationSections(narration), project, plan))
      .toContainEqual(expect.stringContaining("[planning_formula]"));
    expect(() => normalizeNarrationText(narration, project, plan)).toThrow("contains template narration");
  });
  it("caps narration at one initial call and one full replacement", () => {
    const project = {
      id: "narration-recovery-budget",
      title: "Saturn",
      prompt: "Explain Saturn",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount: 10,
    };

    expect(MAX_YANDEX_NARRATION_TEXT_CALLS).toBe(2);
  });

  it("accepts a nine-minute ten-slide narration and flags text below that duration", () => {
    const project = {
      id: "speech-budget",
      title: "BMW history",
      prompt: "Explain BMW history",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount: 10,
    };
    const narration = (wordsPerSlide: number) => Array.from({ length: 10 }, (_, index) => {
      const words = Array.from({ length: wordsPerSlide }, (_, word) => `fact${index}-${word}`).join(" ");
      return `\u0421\u043b\u0430\u0439\u0434 ${index + 1}: BMW ${index + 1}\n${words}.`;
    }).join("\n\n");

    const belowMinimumIssues = validateNarrationSections(parseNarrationSections(narration(116)), project);
    const nineMinuteIssues = validateNarrationSections(parseNarrationSections(narration(117)), project);
    const longIssues = validateNarrationSections(parseNarrationSections(narration(157)), project);
    expect(belowMinimumIssues.some((issue) => issue.includes("duration is below 9 minutes"))).toBe(true);
    expect(nineMinuteIssues.some((issue) => issue.includes("narration duration"))).toBe(false);
    expect(longIssues.some((issue) => issue.includes("duration exceeds 12 minutes"))).toBe(true);
  });

  it.each([
    [6, "5–7 минут", "5-7 minutes"],
    [8, "7–9 минут", "7-9 minutes"],
    [10, "9–12 минут", "9-12 minutes"],
    [12, "12–15 минут", "12-15 minutes"],
    [14, "15+ минут", "15+ minutes"],
  ])("puts the %s-slide duration contract into narrative and narration prompts", (slideCount, narrativeDuration, narrationDuration) => {
    const project = {
      id: `speech-prompt-${slideCount}`,
      title: "BMW history",
      prompt: "Explain BMW history",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount,
    };
    const narrativePrompt = buildNarrativePlanPrompt(project, []);
    const narrationPrompt = buildNarrationPrompt(project, []);
    expect(narrativePrompt).toContain(narrativeDuration);
    expect(narrationPrompt).toContain(narrationDuration);
    const combinedPrompt = `${narrativePrompt}\n${narrationPrompt}`;
    expect(combinedPrompt).not.toContain("7-10");
    expect(combinedPrompt).not.toContain("hard contract");
    if (slideCount === 10) {
      expect(combinedPrompt).toContain("compact, substantive explanation");
      expect(combinedPrompt).toContain("1300 words");
    }
  });

  it("allocates the ten-slide narration target across title, content, and conclusion", () => {
    const project = { id: "speech-plan", title: "BMW history", prompt: "Explain BMW history", scenario: "university_report", level: "university_student", mode: "with_sources", slideCount: 10 };
    const plan = normalizeNarrativePlan([], project);
    expect(plan[0].speechWordTarget).toBe(80);
    expect(plan.at(-1)?.speechWordTarget).toBe(100);
    expect(plan.slice(1, -1).every((item) => item.speechWordTarget === 140)).toBe(true);
    expect(plan.reduce((total, item) => total + (item.speechWordTarget || 0), 0)).toBe(1300);
  });

  it("never shortens visible copy into an ellipsis or treats an incomplete source excerpt as evidence", () => {
    const longSentence = "This complete sentence remains intact even when its configured display limit is shorter than the source sentence.";

    const compact = shortenSentence(longSentence, 30);
    expect(compact.length).toBeLessThanOrEqual(30);
    expect(compact).toMatch(/\.$/);
    expect(compact).not.toMatch(/…|\.\.\.$/);
    expect(looksLikeSentenceFragment("A claim that stops... ")).toBe(true);
    expect(sourceEvidenceForSlide([{ id: "source-1", label: "Source", type: "WEB", size: 0, excerpt: "A source excerpt that stops mid" }], 1)).toBe("");
    expect(sourceEvidenceForSlide([{ id: "source-2", label: "Source", type: "WEB", size: 0, excerpt: "A complete source statement is safe to show." }], 1)).toBe("A complete source statement is safe to show.");
  });

  it("accepts a substantive two-sentence narration section", () => {
    const narration = normalizeNarrationText(
      [
        "Слайд 1: Цель защиты",
        "StudyDeck AI объединяет тему, источники и структуру презентации в один рабочий процесс для студента. На защите это позволяет последовательно объяснить замысел проекта, показать его функции и обосновать практическую ценность выбранного решения.",
      ].join("\n"),
      {
        id: "project-short-narration",
        title: "Защита StudyDeck AI",
        prompt: "Подготовить защиту StudyDeck AI",
        scenario: "university_report",
        level: "university",
        mode: "with_sources",
        slideCount: 1,
      },
    );

    const body = narration.split("\n").slice(1).join(" ");
    expect(sentenceCount(body)).toBe(2);
    expect(sentenceCount(body)).toBeLessThanOrEqual(7);
  });

  it("replaces a fragment-only narration section with a complete script", () => {
    const narration = normalizeNarrationText(
      ["Слайд 1: Спасибо", "Спасибо."].join("\n"),
      {
        id: "project-fragment-narration",
        title: "Защита StudyDeck AI",
        prompt: "Подготовить защиту StudyDeck AI",
        scenario: "university_report",
        level: "university",
        mode: "with_sources",
        slideCount: 1,
      },
    );

    const body = narration.split("\n").slice(1).join(" ");
    expect(sentenceCount(body)).toBeGreaterThanOrEqual(2);
    expect(body.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(25);
    expect(body).not.toBe("Спасибо.");
  });

  it("keeps public generation, planning, quality, and layout exports stable", () => {
    expect(generatePresentation).toBe(generatePresentationFromOrchestrator);
    expect(buildGenerationPrompt).toBe(buildGenerationPromptFromLayer);
    expect(normalizeNarrativePlan).toBe(normalizeNarrativePlanFromLayer);
    expect(findSlideTextIssues).toBe(findSlideTextIssuesFromLayer);
    expect(normalizeLayout).toBe(normalizeLayoutFromLayer);
  });

  it("makes the final narrative job a substantive synthesis instead of a thank-you slide", () => {
    const project = {
      id: "project-closing-plan",
      title: "История Porsche 911",
      prompt: "Подготовь учебную презентацию об истории Porsche 911",
      scenario: "lesson",
      level: "university",
      mode: "with_sources",
      slideCount: 5,
    } as const;
    const plan = normalizeNarrativePlan([
      { slideOrder: 1, slideTitle: "Porsche 911", slidePurpose: "Открыть тему.", keyMessage: "Porsche 911 стал заметной спортивной моделью.", audienceQuestion: "Почему модель важна?", transitionToNext: "Далее." },
      { slideOrder: 2, slideTitle: "Дизайн", slidePurpose: "Разобрать дизайн.", keyMessage: "Узнаваемый дизайн связывает поколения.", audienceQuestion: "Что менялось?", transitionToNext: "Далее." },
      { slideOrder: 3, slideTitle: "Техника", slidePurpose: "Разобрать технику.", keyMessage: "Инженерные решения развивали модель.", audienceQuestion: "Что изменилось?", transitionToNext: "Далее." },
      { slideOrder: 4, slideTitle: "Преемственность", slidePurpose: "Связать изменения.", keyMessage: "Преемственность сохранила характер модели.", audienceQuestion: "Что объединяет поколения?", transitionToNext: "Далее." },
      { slideOrder: 5, slideTitle: "Спасибо за внимание", slidePurpose: "Спасибо.", keyMessage: "Спасибо за внимание.", audienceQuestion: "Вопросы?", transitionToNext: "Далее." },
    ], project);

    expect(plan.at(-1)).toMatchObject({
      slideOrder: 5,
      transitionToNext: "",
    });
    expect(plan.at(-1)?.slideTitle).not.toBe("Спасибо за внимание");
    expect(plan.at(-1)?.keyMessage).not.toBe("Спасибо за внимание.");
    expect(plan.at(-1)?.slidePurpose).not.toContain("Собрать ответ на главный вопрос");
    expect(plan.at(-1)?.slidePurpose).not.toContain("оставить 2–3");
    expect(buildGenerationPrompt(project, [], "", plan)).toContain("never use a standalone final slide");
  });

  it("repairs duplicated visible text on one slide without changing the rest of the deck", () => {
    const project = {
      id: "project-local-slide-repair",
      title: "Защита StudyDeck AI",
      prompt: "Подготовить связную защиту StudyDeck AI для студента.",
      scenario: "project_defense",
      level: "university",
      mode: "fast_draft",
      slideCount: 12,
    };
    const titles = Array.from({ length: 12 }, (_, index) => `Тема защиты ${index + 1}`);
    const generated = presentationSchema.parse({
      id: "presentation-local-slide-repair",
      title: project.title,
      scenario: project.scenario,
      level: project.level,
      slideCount: 12,
      generationMode: "demo",
      generatedText: titles.map((title, index) => [
        `Слайд ${index + 1}: ${title}`,
        `Раздел ${index + 1} объясняет отдельный подтверждённый аспект проекта. Пример для раздела ${index + 1} показывает практический смысл этой части. Вывод раздела ${index + 1} остаётся связанным с темой защиты.`,
      ].join("\n")).join("\n\n"),
      sources: [],
      outline: titles,
      narrativePlan: [],
      speechScript: titles.map((title, index) => ({
        slideOrder: index + 1,
        slideTitle: title,
        text: `Раздел ${index + 1} объясняет отдельный подтверждённый аспект проекта. Пример для раздела ${index + 1} показывает практический смысл этой части. Вывод раздела ${index + 1} остаётся связанным с темой защиты.`,
      })),
      slides: titles.map((title, index) => ({
        id: `local-slide-${index + 1}`,
        order: index + 1,
        title,
        layout: index === 0 ? "hero" : index === 11 ? "summary" : "bullets",
        thesis: `Подтверждённый аспект проекта для темы ${index + 1}.`,
        bullets: [`Практическая деталь темы ${index + 1}.`, `Отдельный вывод темы ${index + 1}.`],
        blocks: [{ type: "bullets" as const, items: [`Практическая деталь темы ${index + 1}.`, `Отдельный вывод темы ${index + 1}.`] }],
        speakerNotes: `Раздел ${index + 1} объясняет отдельный подтверждённый аспект проекта. Пример для раздела ${index + 1} показывает практический смысл этой части. Вывод раздела ${index + 1} остаётся связанным с темой защиты.`,
        timingSeconds: 30,
        sourceRefs: [],
      })),
    });
    const duplicated = presentationSchema.parse({
      ...generated,
      slides: generated.slides.map((slide) => slide.order === 12
        ? { ...slide, bullets: [slide.thesis, slide.thesis], blocks: [{ type: "bullets" as const, items: [slide.thesis, slide.thesis] }] }
        : slide),
    });
    const issues = findSlideTextIssuesFromLayer(duplicated);
    expect(issues).toContainEqual(expect.objectContaining({
      slideOrder: 12,
      reasons: expect.arrayContaining(["visible text is duplicated"]),
    }));

    const repaired = applyNarrationFallbacks(duplicated, issues, project);

    expect(repaired.slides.slice(0, 11)).toEqual(duplicated.slides.slice(0, 11));
    expect(findSlideTextIssuesFromLayer(repaired).find((issue) => issue.slideOrder === 12)?.reasons || [])
      .not.toContain("visible text is duplicated");
  });
});

function yandexTextResponse(text: string) {
  return new Response(
    JSON.stringify({
      result: {
        alternatives: [{ message: { text } }],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("Yandex narration full duration rewrite", () => {
  it("classifies Yandex termination metadata without retaining narration text", () => {
    expect(yandexNarrationCompletionTelemetry({
      result: { alternatives: [{ status: "ALTERNATIVE_STATUS_FINAL" }], usage: { completionTokens: "710" } },
    }, 8000)).toEqual({
      alternativeStatus: "alternative_status_final",
      finishReason: null,
      terminationSignal: "final_without_finish_reason",
      outputTokens: 710,
      maxTokens: 8000,
    });
    expect(yandexNarrationCompletionTelemetry({
      alternatives: [{ finishReason: "length" }], usage: { completionTokens: "8000" },
    }, 8000).terminationSignal).toBe("output_cap");
    expect(yandexNarrationCompletionTelemetry({
      alternatives: [{ finishReason: "content_filter" }], usage: { completionTokens: "12" },
    }, 8000).terminationSignal).toBe("content_filter");
  });

  const project = {
    id: "saturn-duration-rewrite",
    title: "Saturn",
    prompt: "Prepare a presentation about Saturn",
    scenario: "university_report",
    level: "university_student",
    mode: "with_sources",
    slideCount: 10,
  };
  const plan = Array.from({ length: 10 }, (_, index) => ({
    slideOrder: index + 1,
    slideTitle: `Saturn ${index + 1}`,
    slidePurpose: `Present section ${index + 1}`,
    keyMessage: `Key fact ${index + 1}`,
    audienceQuestion: `What is the role of section ${index + 1}?`,
    transitionToNext: "",
    evidenceOrExplanation: `Grounded explanation ${index + 1}`,
    whyItMatters: `Meaning ${index + 1}`,
  }));

  function narrationSection(order: number, words: number) {
    const sentenceWords = Math.floor(words / 3);
    const sentence = (part: number) => Array.from(
      { length: part === 2 ? words - sentenceWords * 2 : sentenceWords },
      (_, index) => `fact${order}_${part}_${index}`,
    ).join(" ");
    return `Слайд ${order}: Saturn ${order}\n${sentence(0)}. ${sentence(1)}. ${sentence(2)}.`;
  }

  function completeNarration(contentWords = 155) {
    return Array.from({ length: 10 }, (_, index) => narrationSection(index + 1, index === 0 ? 105 : index === 9 ? 130 : contentWords)).join("\n\n");
  }

  it("builds a release-ready ten-slide local document from accepted narration without provider calls", async () => {
    const accepted = completeNarration();
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error("provider access is forbidden in the local presentation path"); };
    try {
      const presentation = await generatePresentationFromNarration(project, [{
        id: "saturn-source", label: "Saturn reference", type: "WEB", url: "https://science.example/saturn",
        excerpt: "Saturn is a planet with rings and a complex system of moons.",
      }], accepted);

      expect(presentation.generationMode).toBe("local");
      expect(presentation.slides).toHaveLength(10);
      expect(presentation.generatedText).toBe(accepted);
      expect(presentation.speechScript.map((item) => item.text).join("\n\n")).toBe(accepted.replace(/Слайд \d+: [^\n]+\n/g, "").trim());
      expect(presentation.slides.every((slide) => slide.bullets.length >= 2 && slide.bullets.length <= 3)).toBe(true);
      expect(presentation.slides.flatMap((slide) => auditSlideCanvas(slide.canvas!))).toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("gives the ten-slide full rewrite an exact budget-derived editorial structure", () => {
    const prompt = buildFullNarrationDurationRewritePrompt(
      project,
      [],
      plan,
      "short invalid speech",
      new Error("AI narration quality check failed: narration duration is below 9 minutes"),
    );

    expect(prompt).toContain("1170-1560 words");
    expect(prompt).toContain("all ten headers exactly once");
    expect(prompt).toContain("Слайд 1:");
    expect(prompt).toContain("Слайд 10:");
    expect(prompt).toContain("slide 1 at least 105 words");
    expect(prompt).toContain("slide 10 at least 130 words");
    expect(prompt).toContain("slides 2-9 approximately 115-145 words each");
    expect(prompt).toContain("not a word-padding exercise");
    expect(prompt).toContain("Do not use filler");
    expect(prompt).toContain("copied slidePurpose or audienceQuestion text");
    expect(prompt).not.toContain("hard contract");
  });

  it("derives non-ten-slide full rewrite guidance from that preset rather than the ten-slide rule", () => {
    const eightSlideProject = { ...project, id: "eight-slide-duration-rewrite", slideCount: 8 };
    const prompt = buildFullNarrationDurationRewritePrompt(
      eightSlideProject,
      [],
      plan.slice(0, 8),
      "short invalid speech",
      new Error("AI narration quality check failed: narration duration is below 7 minutes"),
    );

    expect(prompt).toContain("910-1170 words");
    expect(prompt).toContain("all 8 headers exactly once");
    expect(prompt).toContain("slide 1 is about 80 words");
    expect(prompt).toContain("slide 8 is about 120 words");
    expect(prompt).toContain("middle sections are approximately 115-165 words each");
    expect(prompt).not.toContain("slides 2-9 approximately 115-145 words each");
  });

  it("uses one full Yandex rewrite for a short narration and accepts only the complete replacement", async () => {
    process.env.YANDEX_FOLDER_ID = "test-folder";
    const short = Array.from({ length: 10 }, (_, index) => narrationSection(index + 1, 60)).join("\n\n");
    const originalFetch = global.fetch;
    const bodies: Record<string, unknown>[] = [];
    let calls = 0;
    global.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return yandexTextResponse(calls++ === 0 ? short : completeNarration());
    };

    try {
      const result = await generateYandexNarration("test-key", project, [], plan);
      expect(calls).toBe(2);
      expect(parseNarrationSections(result).map((section) => section.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(() => normalizeNarrationText(result, project, plan)).not.toThrow();
      const rewritePrompt = String((bodies[1] as { messages?: Array<{ text?: string }> }).messages?.[1]?.text || "");
      expect(rewritePrompt).toContain("completely new, coherent report");
      expect(rewritePrompt).toContain("1170-1560 words");
      expect(rewritePrompt).not.toContain("hard contract");
      expect(result).not.toContain(plan[0].slidePurpose);
      expect(result).not.toContain(plan[0].audienceQuestion);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses an explicit narration candidate for the initial speech and its full duration rewrite", async () => {
    process.env.YANDEX_FOLDER_ID = "test-folder";
    process.env.YANDEX_NARRATION_MODEL_NAME = "yandexgpt-5.1";
    process.env.YANDEX_NARRATION_MODEL_URI = "gpt://test-folder/yandexgpt-5.1";
    const short = Array.from({ length: 10 }, (_, index) => narrationSection(index + 1, 60)).join("\n\n");
    const originalFetch = global.fetch;
    const bodies: Record<string, unknown>[] = [];
    let calls = 0;
    global.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return yandexTextResponse(calls++ === 0 ? short : completeNarration());
    };

    try {
      await generateYandexNarration("test-key", project, [], plan);
      expect(bodies.map((body) => body.modelUri)).toEqual([
        "gpt://test-folder/yandexgpt-5.1",
        "gpt://test-folder/yandexgpt-5.1",
      ]);
    } finally {
      process.env.YANDEX_NARRATION_MODEL_NAME = "";
      process.env.YANDEX_NARRATION_MODEL_URI = "";
      global.fetch = originalFetch;
    }
  });

  it("uses a full rewrite directly for an initial spoken-narration defect", async () => {
    process.env.YANDEX_FOLDER_ID = "test-folder";
    const initial = completeNarration(120).replace("fact2_0_0", `${";".repeat(93)} fact2_0_0`);
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => yandexTextResponse([initial, completeNarration()][calls++] || "");

    try {
      const result = await generateYandexNarration("test-key", project, [], plan);
      expect(calls).toBe(2);
      expect(() => normalizeNarrationText(result, project, plan)).not.toThrow();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("fails safely when the sole full rewrite remains below the minimum", async () => {
    process.env.YANDEX_FOLDER_ID = "test-folder";
    const short = Array.from({ length: 10 }, (_, index) => narrationSection(index + 1, 60)).join("\n\n");
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => yandexTextResponse(calls++ === 0 ? short : short);

    try {
      await expect(generateYandexNarration("test-key", project, [], plan)).rejects.toThrow("narration_quality_failure");
      expect(calls).toBe(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not invoke a duration rewrite for non-duration provider or section failures", async () => {
    process.env.YANDEX_FOLDER_ID = "test-folder";
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      throw new Error("Yandex request failed: 503 unavailable");
    };

    try {
      await expect(generateYandexNarration("test-key", project, [], plan)).rejects.toThrow("narration_provider_failure");
      expect(calls).toBe(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("caps AITUNNEL narration at one initial call and one complete rewrite", async () => {
    const short = Array.from({ length: 10 }, (_, index) => narrationSection(index + 1, 60)).join("\n\n");
    let calls = 0;
    const models: string[] = [];
    const client = {
      responses: { create: async (request: { model: string }) => { models.push(request.model); return { output_text: [short, completeNarration()][calls++], usage: { input_tokens: 100, output_tokens: 100 } }; } },
    } as never;

    const result = await generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan);
    expect(MAX_AITUNNEL_NARRATION_TEXT_CALLS).toBe(2);
    expect(calls).toBe(2);
    expect(models).toEqual(["gemini-3.5-flash-lite", "gemini-3.6-flash"]);
    expect(() => normalizeNarrationText(result, project, plan)).not.toThrow();
  });

  it("uses a context-light full AITUNNEL rewrite without rejected text or raw validation details", () => {
    const sentinel = "REJECTED_NARRATION_SENTINEL_DO_NOT_SEND";
    const rawError = "RAW_VALIDATION_DETAIL_DO_NOT_SEND";
    const oldPrompt = buildFullNarrationDurationRewritePrompt(project, [], plan, sentinel.repeat(600), new Error(rawError));
    const rewritePrompt = buildAitunnelFullNarrationRewritePrompt(project, [], plan, undefined, "duration");

    expect(rewritePrompt).toContain("Discard it completely");
    expect(rewritePrompt).toContain("fresh, complete narration for every requested slide");
    expect(rewritePrompt).toContain("1170-1560 words");
    expect(rewritePrompt).not.toContain(sentinel);
    expect(rewritePrompt).not.toContain(rawError);
    expect(rewritePrompt).not.toContain("Previous invalid answer");
    expect(estimateInputTokens({ input: rewritePrompt })).toBeLessThan(estimateInputTokens({ input: oldPrompt }));
  });

  it("maps narration validation defects to safe rewrite categories without preserving their text", () => {
    expect(classifyAitunnelNarrationRewriteFailure(new Error("narration duration is below 9 minutes"))).toBe("duration");
    expect(classifyAitunnelNarrationRewriteFailure(new Error("missing narration section 4"))).toBe("headers_or_sections");
    expect(classifyAitunnelNarrationRewriteFailure(new Error("template phrase detected"))).toBe("template_or_repetition");
    expect(classifyAitunnelNarrationRewriteFailure(new Error("section repeats a complete sentence"))).toBe("template_or_repetition");
    expect(classifyAitunnelNarrationRewriteFailure(new Error("narration repeats a narrative-plan field"))).toBe("spoken_quality");
    expect(classifyAitunnelNarrationRewriteFailure(new Error("PRIVATE_PROVIDER_DERIVED_DETAIL"))).toBe("narration_quality");
  });

  it("fits the ten-slide initial actual cost and context-light rewrite reservation inside the narration cap", () => {
    const initialPrompt = buildNarrationPrompt(project, [], plan);
    const rewritePrompt = buildAitunnelFullNarrationRewritePrompt(project, [], plan, undefined, "duration");
    const initialRequest = { model: "gemini-3.6-flash", input: [{ role: "system", content: NARRATION_SYSTEM_PROMPT }, { role: "user", content: initialPrompt }], max_output_tokens: 2400, reasoning: { effort: "minimal", exclude: true } };
    const rewriteRequest = { ...initialRequest, input: [{ role: "system", content: NARRATION_SYSTEM_PROMPT }, { role: "user", content: rewritePrompt }] };
    const budget = new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "30", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "20" });
    expect(budget.reserve("initial", "narration", initialRequest)).toMatchObject({ status: "reserved" });
    expect(budget.settle("initial", { inputTokens: 100, outputTokens: 100 })).toMatchObject({ status: "settled" });
    expect(budget.reserve("rewrite", "narration_rewrite", rewriteRequest)).toMatchObject({ status: "reserved" });
  });

  it("accepts a valid initial AITUNNEL narration without a rewrite", async () => {
    let calls = 0;
    const models: string[] = [];
    const client = {
      responses: { create: async (request: { model: string }) => { models.push(request.model); return { output_text: completeNarration(), usage: { input_tokens: 100, output_tokens: 100 }, id: `response-${++calls}` }; } },
    } as never;

    await expect(generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)).resolves.toContain("Слайд 1:");
    expect(calls).toBe(1);
    expect(models).toEqual(["gemini-3.5-flash-lite"]);
  });

  it("stops after an invalid Lite candidate and invalid single Flash fallback", async () => {
    const short = Array.from({ length: 10 }, (_, index) => narrationSection(index + 1, 60)).join("\n\n");
    const models: string[] = [];
    const client = { responses: { create: async (request: { model: string }) => { models.push(request.model); return { output_text: short, usage: { input_tokens: 100, output_tokens: 100 } }; } } } as never;

    await expect(generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)).rejects.toThrow("narration_quality_failure");
    expect(models).toEqual(["gemini-3.5-flash-lite", "gemini-3.6-flash"]);
  });

  it("does not spend on a narration call when its reservation is refused", async () => {
    let calls = 0;
    const client = { responses: { create: async () => { calls += 1; return { output_text: completeNarration(), usage: { input_tokens: 100, output_tokens: 100 } }; } } } as never;
    const budget = new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "0.00000001", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "0.00000001" });

    await expect(runWithAitunnelProjectBudget(budget, () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan))).rejects.toThrow("narration_budget_exhausted_failure");
    expect(calls).toBe(0);
  });

  it("does not retry an AITUNNEL provider failure", async () => {
    let calls = 0;
    const client = {
      responses: { create: async () => { calls += 1; throw new Error("provider unavailable"); } },
    } as never;

    await expect(generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)).rejects.toThrow("narration_provider_failure");
    expect(calls).toBe(1);
  });

  it("sends AITUNNEL narration limits and fails safely when provider usage is absent", async () => {
    let calls = 0;
    const client = {
      responses: { create: async (request: Record<string, unknown>) => {
        calls += 1;
        expect(request).toMatchObject({
          model: "gemini-3.5-flash-lite",
          max_output_tokens: 2400,
          reasoning: { effort: "minimal", exclude: true },
        });
        return { output_text: completeNarration() };
      } },
    } as never;

    await expect(generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)).rejects.toThrow("narration_usage_unavailable_failure");
    expect(calls).toBe(1);
  });
});
function narrativePlanForTitles(titles: string[]) {
  return titles.map((title, index) => ({
    slideOrder: index + 1,
    slideTitle: title,
    slidePurpose: index === 0 ? "Открыть тему выступления через понятный контекст." : "Раскрыть следующий смысловой шаг выступления.",
    keyMessage: `${title} помогает понять главную логику темы.`,
    audienceQuestion: `Что важно понять про ${title}?`,
    transitionToNext: index === titles.length - 1 ? "" : "После этой мысли логично уточнить следующий аспект темы.",
  }));
}

function designBriefForTitles(titles: string[]) {
  return {
    themeId: "editorialMagazine",
    mood: "serious",
    audienceFit: "A clear editorial study deck for the requested audience.",
    visualMetaphor: "A guided sequence of evidence and conclusions.",
    colorIntent: "High contrast with one restrained accent.",
    typographyIntent: "Editorial headings with readable supporting text.",
    rhythm: {
      titleStyle: "editorial",
      density: "medium",
      imageFrequency: "balanced",
      sectionBreaks: true,
    },
    slideDirections: titles.map((title, index) => ({
      slideOrder: index + 1,
      visualRole: index === 0 ? "hero" : index === titles.length - 1 ? "summary" : "explain",
      layoutIntent: index === 0 ? "full_bleed_image" : index === titles.length - 1 ? "summary" : "cards",
      imageStrategy: index === 0 ? "real_photo" : "diagram",
      visualPrompt: `Editorial visual for ${title}`,
    })),
  };
}

function mockYandexTwoStep(
  narrationText: string,
  json: unknown,
  bodies?: unknown[],
  repairJson?: unknown,
  rewrittenNarrationText?: string,
) {
  let callCount = 0;
  const titles = narrationText
    .split("\n")
    .map((line) => line.match(/^\S+\s+\d+\s*:\s*(.+)$/)?.[1])
    .filter((title): title is string => Boolean(title));
  const narrativePlan = narrativePlanForTitles(titles.length ? titles : ["Intro"]);
  global.fetch = async (_input, init) => {
    bodies?.push(JSON.parse(String(init?.body || "{}")));
    callCount += 1;
    if (callCount === 1) return yandexTextResponse(JSON.stringify(narrativePlan));
    if (callCount === 2) return yandexTextResponse(narrationText);
    if (rewrittenNarrationText && callCount === 3) return yandexTextResponse(rewrittenNarrationText);
    const offset = rewrittenNarrationText ? 1 : 0;
    if (callCount === 3 + offset) return yandexTextResponse(JSON.stringify(designBriefForTitles(narrativePlan.map((item) => item.slideTitle))));
    const response = callCount === 4 + offset || repairJson === undefined ? json : repairJson;
    return yandexTextResponse(typeof response === "string" ? response : JSON.stringify(response));
  };
}

function mockYandexNarrationRewrite(initialText: string, rewrittenText: string) {
  let narrationCalls = 0;
  const titles = rewrittenText
    .split("\n")
    .map((line) => line.match(/^\S+\s+\d+\s*:\s*(.+)$/)?.[1])
    .filter((title): title is string => Boolean(title));
  const sections = parseNarrationSections(rewrittenText);
  global.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const systemText = String(body.messages?.[0]?.text || "");
    if (systemText.includes("full Russian oral narration")) {
      narrationCalls += 1;
      if (narrationCalls === 1) return yandexTextResponse(initialText);
      const requested = String(body.messages?.[1]?.text || "").match(/Return exactly these sections once each and in this order:\s*([\d, ]+)/i)?.[1]
        .split(",")
        .map((value: string) => Number(value.trim()))
        .filter(Number.isFinite);
      const replacement = requested?.length
        ? parseNarrationSections(rewrittenText)
          .filter((section) => requested.includes(section.order))
          .map((section) => `Слайд ${section.order}: ${section.title}\n${section.text}`)
          .join("\n\n")
        : rewrittenText;
      return yandexTextResponse(replacement);
    }
    if (systemText.includes("story planner")) {
      return yandexTextResponse(JSON.stringify(narrativePlanForTitles(titles)));
    }
    if (systemText.includes("art director")) {
      return yandexTextResponse(JSON.stringify(designBriefForTitles(titles)));
    }
    if (systemText.includes("structured study presentations")) {
      return yandexTextResponse(JSON.stringify({
        title: titles[0] || "Presentation",
        generatedText: rewrittenText,
        outline: titles,
        slides: titles.map((title, index) => ({
          id: `slide-${index + 1}`,
          order: index + 1,
          title,
          slideKind: index === 0 ? "title" : index === titles.length - 1 ? "summary" : "content",
          layout: "statement",
          thesis: `${title} develops finding ${index + 1} for this report.`,
          bullets: [`Evidence ${index + 1} explains focus${index + 1}`, `Consequence ${index + 1} changes the conclusion`],
          speakerNotes: sections[index]?.text || "",
          timingSeconds: 60,
          sourceRefs: [],
        })),
        speechScript: sections.map((section) => ({ slideOrder: section.order, slideTitle: section.title, text: section.text })),
      }));
    }
    throw new Error(`Unexpected Yandex test request: ${systemText.slice(0, 80)}`);
  };
}

function narrationForSlides(titles: string[]) {
  const details = [
    ["контекст", "пример", "вывод"],
    ["причина", "изменение", "последствие"],
    ["сравнение", "граница", "результат"],
    ["этап", "действие", "проверка"],
    ["качество", "связь", "решение"],
    ["история", "поворот", "оценка"],
  ];
  const endings = [
    "В конце этой мысли становится ясно, почему тема звучит убедительно.",
    "Такой вывод показывает реальное значение этой части истории.",
    "Именно поэтому этот материал остается важным для общего понимания.",
    "В результате слушатель видит не набор фактов, а понятную картину.",
    "Так раскрывается практический смысл этой темы для выступления.",
    "Эта мысль завершает объяснение спокойно и без лишних общих слов.",
  ];
  return titles
    .map((title, index) => {
      const [first, second, third] = details[index % details.length];
      return [
        `Слайд ${index + 1}: ${title}`,
        `${title} раскрывает ${first}, который задает направление всему объяснению. Затем появляется ${second}, потому что без него слушателю трудно увидеть развитие мысли. Конкретный ${third} показывает, чем эта часть отличается по смыслу. Важная деталь делает название "${title}" частью реального содержания. ${endings[index % endings.length]}`,
      ].join("\n");
    })
    .join("\n\n");
}

function overlongNarrationForSlides(titles: string[]) {
  return titles
    .map((title, index) => {
      const order = index + 1;
      const body = [
        "This slide repeats the same weak opening formula before the real content starts.",
        `${title} has a concrete first point for the study report number ${order}.`,
        `${title} gives the listener a useful example that belongs to this exact topic.`,
        `${title} explains one cause without copying the original user request.`,
        `${title} adds a consequence that makes the section more specific.`,
        `${title} names a practical detail that can become short screen text.`,
        `${title} keeps the narration focused on the subject instead of the deck structure.`,
        `${title} includes another useful fact so the repair has enough material.`,
        `${title} shows why the topic matters for the final explanation.`,
        "The main takeaway of the topic is repeated as a generic ending.",
        "This slide repeats the same weak opening formula before the real content starts.",
        "The main takeaway of the topic is repeated as a generic ending.",
      ];
      return `\u0421\u043b\u0430\u0439\u0434 ${order}: ${title}\n${body.join(" ")}`;
    })
    .join("\n\n");
}

function weakOverlongNarrationForSlides(titles: string[]) {
  return titles
    .map((title, index) => {
      const order = index + 1;
      const body = [
        "This slide repeats the same weak opening formula before the real content starts.",
        `${title} has one concrete point for the study report number ${order}.`,
        `${title} gives one useful example that belongs to this exact topic.`,
        `${title} explains one cause without copying the original user request.`,
        `${title} adds one consequence that makes the section more specific.`,
        "Create a presentation about narration repair.",
        "The main takeaway of the topic is repeated as a generic ending.",
        "This slide repeats the same weak opening formula before the real content starts.",
        "The main takeaway of the topic is repeated as a generic ending.",
      ];
      return `\u0421\u043b\u0430\u0439\u0434 ${order}: ${title}\n${body.join(" ")}`;
    })
    .join("\n\n");
}

describe("selectAiProviders", () => {
  it("does not fall back to Yandex when explicitly selected OpenAI is unavailable", () => {
    expect(
      selectAiProviders({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "",
        YANDEX_API_KEY: "yandex-key",
        YANDEX_FOLDER_ID: "folder-id",
      }),
    ).toEqual([]);
  });

  it("uses only the explicitly requested provider even when both are configured", () => {
    expect(
      selectAiProviders({
        AI_PROVIDER: "yandex",
        OPENAI_API_KEY: "openai-key",
        YANDEX_API_KEY: "yandex-key",
        YANDEX_FOLDER_ID: "folder-id",
      }),
    ).toEqual(["yandex"]);
    expect(
      selectAiProviders({
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-key",
        YANDEX_API_KEY: "yandex-key",
        YANDEX_FOLDER_ID: "folder-id",
      }),
    ).toEqual(["openai"]);
  });
});

describe("buildGenerationPrompt", () => {
  it("describes structured slides and visual selection rules", () => {
    const prompt = buildGenerationPrompt(
      {
        id: "project-1",
        title: "Learning topic",
        prompt: "Explain a process and compare two concepts",
        scenario: "lesson",
        level: "beginner",
        mode: "with_sources",
        slideCount: 6,
      },
      [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Grounding material." }],
    );

    expect(prompt).toContain("slideKind title");
    expect(prompt).toContain("slideKind summary");
    expect(prompt).toContain("layout must be one of");
    expect(prompt).not.toContain("question-answer");
    expect(prompt).not.toContain("case-study");
    expect(prompt).not.toContain("myth-fact");
    expect(prompt).not.toContain("two-column");
    expect(prompt).toContain("3-5 dated or named periods");
    expect(prompt).not.toContain("criterion in visual.rows[].label");
    expect(prompt).not.toContain("bullets contain 2-3 supporting parts");
    expect(prompt).not.toContain("problem-solution");
    expect(prompt).not.toContain("layout must be one of: hero, bullets, summary, statement, quote, definition");
    expect(prompt).not.toContain("layout must be one of: hero, bullets");
    expect(prompt).not.toContain("use evidence for");
    expect(prompt).not.toContain("use explain-example for");
    expect(prompt).toContain("never turn list order into a metric");
    expect(prompt).toContain("do not use the same content layout more than twice in a row");
    expect(prompt).toContain("one clear thesis plus 2-3 short meaningful points");
    expect(prompt).toContain("semantic and memorable");
    expect(prompt).toContain("keyConcepts: return an empty array");
    expect(prompt).toContain("highlights: return an empty array");
    expect(prompt).toContain("2-7 sentence");
    expect(prompt).toContain("generatedText");
    expect(prompt).toContain("Do not generate a separate second story");
    expect(prompt).toContain("Do not write long text blocks");
    expect(prompt).toContain("must be a complete thought");
    expect(prompt).toContain("every slide, including title, section, and summary slides, must include visual.description");
    expect(prompt).toContain("set visual.type to image or illustration");
    expect(prompt).toContain("never fill visual.title, visual.items, or visual.rows with generic placeholder text");
    expect(prompt).toContain("process_diagram");
    expect(prompt).toContain("comparison_diagram");
    expect(prompt).toContain("mind_map");
    expect(prompt).toContain("visual.description must describe a concrete, searchable image");
    expect(prompt).toContain("do not put URLs");
    expect(prompt).toContain("Do not invent precise facts");
    expect(prompt).toContain("Visual theme rules");
    expect(prompt).toContain("preset=");
    expect(prompt).toContain("do not invent CSS");
  });

  it("carries the student-only creation brief into the generation prompt", () => {
    const project = {
      id: "project-student",
      title: "AI in higher education",
      prompt: "Create a university seminar presentation about AI in higher education.",
      scenario: "university_report",
      level: "university_student",
      mode: "with_sources",
      slideCount: 8,
    };
    const prompt = buildGenerationPrompt(project, []);

    expect(prompt).toContain("university_student");
    expect(prompt).toContain("easy_professional");
    expect(prompt).toContain("brief_slides_full_speech");
    expect(prompt).toContain("images_and_diagrams");
    expect(prompt).toContain("web_and_pptx_pdf");
    expect(prompt).toContain("short beautiful slides");
    expect(prompt).toContain("full explanation in speakerNotes and speechScript");
  });
});

describe("structured generation helper", () => {
  it("classifies only recoverable Yandex structured-presentation failures", () => {
    expect(isRecoverableYandexStructuredPresentationError(new StructuredGenerationError("studydeck_presentation", new SyntaxError("Unterminated string in JSON")))).toBe(true);
    expect(isRecoverableYandexStructuredPresentationError(new Error("structured presentation response must contain 10 slides"))).toBe(true);
    expect(isRecoverableYandexStructuredPresentationError(new Error("Yandex generation request failed: 401"))).toBe(false);
    expect(isRecoverableYandexStructuredPresentationError(new Error("AI narration quality check failed"))).toBe(false);
    expect(isRecoverableYandexStructuredPresentationError(new Error("Production quality gate rejected generated presentation"))).toBe(false);
  });

  it("partitions presentation recovery into exact ordered chunks", () => {
    expect(presentationRecoveryChunks(10)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9, 10]]);
    expect(presentationRecoveryChunks(2)).toEqual([[1], [2]]);
  });

  it("uses the Vercel AI SDK path for OpenAI structured output", async () => {
    const calls: any[] = [];
    const fakeGenerateText = async (body: any) => {
      calls.push(body);
      return { output: { title: "Plan", summary: "Short Russian university brief." } };
    };

    const result = await generateStructuredWithProvider({
      provider: "openai",
      system: "Return JSON only.",
      prompt: "Create a short brief.",
      schemaName: "studydeck_sdk_brief",
      schema: z.object({ title: z.string(), summary: z.string() }),
      openAIGenerateText: fakeGenerateText as any,
    });

    expect(result).toEqual({ title: "Plan", summary: "Short Russian university brief." });
    expect(calls[0].prompt).toContain("Return only JSON");
    expect(calls[0].output).toBeTruthy();
    expect(calls[0].temperature).toBe(0.25);
  });

  it("uses strict OpenAI json schema for small structured artifacts", async () => {
    const calls: any[] = [];
    const client = {
      responses: {
        create: async (body: any) => {
          calls.push(body);
          return { output_parsed: { title: "РџР»Р°РЅ", summary: "РљРѕСЂРѕС‚РєРёР№ СЂСѓСЃСЃРєРёР№ РІС‹РІРѕРґ." } };
        },
      },
    };

    const result = await generateStructuredWithProvider({
      provider: "openai",
      system: "Return JSON only.",
      prompt: "Create a short brief.",
      schemaName: "studydeck_test_brief",
      schema: z.object({ title: z.string(), summary: z.string() }),
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["title", "summary"],
      },
      openAIClient: client as any,
    });

    expect(result.title).toBe("РџР»Р°РЅ");
    expect(calls[0].text.format).toMatchObject({
      type: "json_schema",
      name: "studydeck_test_brief",
      strict: true,
    });
    expect(calls[0].input[1].content).toContain("Return only JSON");
  });

  it("repairs invalid JSON once and keeps Zod as the final validation gate", async () => {
    const calls: any[] = [];
    const client = {
      responses: {
        create: async (body: any) => {
          calls.push(body);
          return calls.length === 1
            ? { output_text: "{ bad json" }
            : { output_text: JSON.stringify({ title: "РџР»Р°РЅ", summary: "РСЃРїСЂР°РІР»РµРЅРЅС‹Р№ РІС‹РІРѕРґ." }) };
        },
      },
    };

    const result = await generateStructuredWithProvider({
      provider: "openai",
      system: "Return JSON only.",
      prompt: "Create a short brief.",
      schemaName: "studydeck_test_brief",
      schema: z.object({ title: z.string(), summary: z.string() }),
      parse: (value) => (typeof value === "string" ? JSON.parse(value) : value),
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["title", "summary"],
      },
      openAIClient: client as any,
    });

    expect(result.summary).toContain("РСЃРїСЂР°РІ");
    expect(calls).toHaveLength(2);
    expect(calls[1].input[1].content).toContain("previous response was not valid JSON");
  });

  it("uses generic Yandex json_object when no JSON schema is provided", async () => {
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    global.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return yandexTextResponse(JSON.stringify({ title: "РџР»Р°РЅ" }));
    };

    try {
      await generateStructuredWithProvider({
        provider: "yandex",
        system: "Return JSON only.",
        prompt: "Create a short object.",
        schemaName: "studydeck_generic_json",
        schema: z.object({ title: z.string() }),
        parse: (value) => (typeof value === "string" ? JSON.parse(value) : value),
        yandexApiKey: "yandex-key",
      });

      expect(bodies[0].json_object).toBe(true);
      expect(bodies[0].json_schema).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("falls back to Yandex json_object when a schema allows additional properties", async () => {
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    global.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return yandexTextResponse(JSON.stringify({ title: "Plan", extra: "allowed" }));
    };

    try {
      await generateStructuredWithProvider({
        provider: "yandex",
        system: "Return JSON only.",
        prompt: "Create a short object.",
        schemaName: "studydeck_open_json",
        schema: z.object({ title: z.string() }).passthrough(),
        parse: (value) => (typeof value === "string" ? JSON.parse(value) : value),
        jsonSchema: {
          type: "object",
          additionalProperties: true,
          properties: { title: { type: "string" } },
        },
        yandexApiKey: "yandex-key",
      });

      expect(bodies[0].json_object).toBe(true);
      expect(bodies[0].json_schema).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("slide-facing text quality", () => {
  it("flags visible bullets that end as unfinished predicate phrases", () => {
    const issues = findSlideTextIssues({
      slides: [
        {
          order: 2,
          title: "Что стоит понять сначала",
          thesis: "РКСИ имеет богатую историю и традиции.",
          bullets: ["Первое что стоит отметить это богатая"],
          blocks: [],
          definition: null,
          visual: { title: "", items: [], rows: [], leftLabel: "", rightLabel: "" },
          speakerNotes: "РКСИ имеет богатую историю и традиции. Колледж прошел долгий путь развития. Его девиз помогает понять отношение к образованию. Эта мысль важна для вступления. Так слушатель видит основу темы.",
        },
      ],
    } as any);

    expect(issues).toEqual([
      {
        slideOrder: 2,
        fields: ["bullets.0"],
        reasons: ["sentence fragment"],
      },
    ]);
  });

  it("flags Alfa-style local fallback formulas in visible slide text", () => {
    const issues = findSlideTextIssues({
      slides: [
        {
          order: 4,
          title: "Перед финалом остаются самые сильные факты",
          thesis: "Сложную часть \"Альфа-Банк\" лучше передать коротко и по существу.",
          bullets: [
            "Связь между фактами делает \"Альфа-Банк\" понятнее для слушателя.",
            "Банк развивает цифровые сервисы для повседневных финансовых задач.",
          ],
          blocks: [{ type: "callout", content: "Конкретный случай помогает объяснить \"Альфа-Банк\" через понятный опыт." }],
          definition: null,
          visual: { title: "", items: [], rows: [], leftLabel: "", rightLabel: "" },
          speakerNotes: "Альфа-Банк работает как крупная финансовая организация, поэтому его удобно рассматривать через услуги, цифровые каналы и клиентский опыт. В такой теме важно не придумывать неподтверждённые цифры, а говорить о том, как банк взаимодействует с людьми. Цифровые сервисы делают банковские операции быстрее и привычнее для клиента. При этом качество сервиса зависит от надёжности, доступности и доверия. Поэтому вывод должен быть осторожным и опираться на проверяемые наблюдения.",
        },
      ],
    } as any);

    expect(issues).toEqual([
      {
        slideOrder: 4,
        fields: ["title", "thesis", "bullets.0", "blocks.0.content"],
        reasons: ["generic or meta text"],
      },
    ]);
  });

  it("flags prompt echoes and cautious fallback formulas in visible slide text", () => {
    const issues = findSlideTextIssues({
      slides: [
        {
          order: 7,
          title: "Связи: Карибский кризис",
          thesis: "Подготовь академическую, но легкую для устного выступления студенческую презентацию на 10 слайдов по теме: Карибский кризис.",
          bullets: [
            "Карибский кризис требует осторожных формулировок без неподтверждённых деталей.",
            "Карибский кризис лучше объяснять через проверяемые причины и последствия.",
          ],
          blocks: [],
          definition: null,
          visual: { title: "", items: [], rows: [], leftLabel: "", rightLabel: "" },
          speakerNotes: "Карибский кризис стал одним из самых опасных эпизодов холодной войны. США и СССР оказались близко к прямому столкновению из-за размещения ракет и взаимного давления. Главная опасность была не только в оружии, но и в скорости решений. Переговоры помогли снизить риск войны. Поэтому этот кризис важно рассматривать как пример предельной ответственности политических лидеров.",
        },
      ],
    } as any);

    expect(issues).toEqual([
      {
        slideOrder: 7,
        fields: ["title", "thesis", "bullets.0", "bullets.1"],
        reasons: ["generic or meta text"],
      },
    ]);
  });
});

describe("layout normalization", () => {
  const base = {
    title: "Почему меняется результат",
    thesis: "Проблема возникает из-за неверного способа, а решение требует проверки.",
    bullets: ["Проблема мешает получить результат", "Причина связана с исходными данными", "Решение начинается с проверки"],
    definition: null,
    visual: { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
    blocks: [],
    sourceRefs: [],
  } as any;

  it("selects supported layouts without returning removed templates", () => {
    expect(inferContentLayout(base, 2)).not.toBe("problem-solution");
    expect(Array.from({ length: 12 }, (_, index) => inferContentLayout(base, index + 2))).not.toContain("case-study");
    expect(inferContentLayout({ ...base, thesis: "Тезис подтверждают несколько фактов.", bullets: ["Факт один", "Факт два"], sourceRefs: [{ sourceId: "s", label: "Источник", excerpt: "Факт", page: null }] }, 3)).not.toBe("evidence");
    expect(inferContentLayout({ ...base, title: "Что такое фотосинтез", thesis: "Это процесс преобразования света.", bullets: ["Например, растение использует солнечный свет"], definition: { term: "Фотосинтез", text: "Преобразование энергии света." } }, 4)).not.toBe("explain-example");
  });

  it("does not keep metrics when the slide has no measurable values", () => {
    expect(normalizeLayout("metrics", 2, 5, "content", { ...base, thesis: "Качественное изменение без чисел." })).not.toBe("metrics");
  });

  it("does not normalize removed comparison templates for new generation", () => {
    const comparison = {
      ...base,
      visual: {
        ...base.visual,
        type: "comparison_diagram",
        leftLabel: "Первый подход",
        rightLabel: "Второй подход",
        rows: [
          { label: "Скорость", left: "Быстро", right: "Медленно" },
          { label: "Точность", left: "Средняя", right: "Высокая" },
        ],
      },
    };

    expect(normalizeLayout("two-column", 2, 5, "content", comparison)).not.toBe("comparison");
    expect(normalizeLayout("comparison", 2, 5, "content", base)).not.toBe("comparison");
    expect(normalizeLayout("case-study", 2, 5, "content", base)).not.toBe("case-study");
  });

  it("rejects sparse sequence, question-answer, and myth-fact layouts", () => {
    expect(normalizeLayout("process", 2, 6, "content", base)).not.toBe("process");
    expect(normalizeLayout("timeline", 2, 6, "content", base)).not.toBe("timeline");
    expect(normalizeLayout("question-answer", 2, 6, "content", { ...base, title: "Почему это важно?", bullets: [] })).not.toBe("question-answer");
    expect(normalizeLayout("myth-fact", 2, 6, "content", base)).not.toBe("myth-fact");
  });
});

describe("normalizeNarrativePlan", () => {
  it("repairs plan length, order, generic fields, and final transition", () => {
    const plan = normalizeNarrativePlan(
      [
        {
          slideOrder: 99,
          slideTitle: "Ключевые факты",
          slidePurpose: "",
          keyMessage: "AI changes how lessons are prepared.",
          audienceQuestion: "How does AI change lesson prep?",
          transitionToNext: "Перейдем к следующему слайду.",
        },
      ],
      {
        id: "project-1",
        title: "AI in education",
        prompt: "Explain how AI changes education",
        scenario: "lesson",
        level: "beginner",
        mode: "with_sources",
        slideCount: 3,
      },
    );

    expect(plan).toHaveLength(3);
    expect(plan.map((item) => item.slideOrder)).toEqual([1, 2, 3]);
    expect(plan[0].slideTitle).not.toBe("Ключевые факты");
    expect(plan[0].transitionToNext).toBeTruthy();
    expect(plan[2].transitionToNext).toBe("");
  });
});

describe("generatePresentation fallback behavior", () => {
  it("creates an editable narration draft before deck generation", async () => {
    process.env.AI_PROVIDER = "";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.AITUNNEL_API_KEY = "";
    process.env.AI_PROVIDER = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const draft = await generateNarrationDraft(
      {
        id: "project-script",
        title: "Экология города",
        prompt: "Сделай презентацию про экологию города",
        scenario: "school_report",
        level: "8-11 класс",
        mode: "with_sources",
        slideCount: 4,
      },
      [{ id: "src-1", label: "Prompt", type: "PROMPT", excerpt: "Городская экология зависит от воздуха, транспорта и поведения жителей." }],
    );

    expect(draft.generationMode).toBe("demo");
    expect(draft.text.match(/Слайд\s+\d+\s*:/g)).toHaveLength(4);
    expect(draft.narrativePlan).toHaveLength(4);
  });

  it("rejects accepted narration instead of creating a demo-fallback deck when no provider is configured", async () => {
    process.env.AI_PROVIDER = "";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const acceptedNarration = [
      "Слайд 1: Городской воздух",
      "Городской воздух меняется из-за транспорта и плотной застройки. Машины создают выхлопы, которые особенно заметны рядом с крупными дорогами. Зеленые зоны помогают удерживать пыль и делают улицы комфортнее. Жителям важно понимать, что качество воздуха зависит не только от заводов. Поэтому экологичный транспорт становится частью повседневной заботы о городе.",
      "",
      "Слайд 2: Практичный вывод",
      "Экология города складывается из решений власти, бизнеса и самих жителей. Если люди чаще выбирают общественный транспорт, нагрузка на воздух становится меньше. Раздельный сбор помогает не превращать полезные материалы в лишний мусор. Небольшие привычки работают сильнее, когда их поддерживает много людей. Главный вывод в том, что чистый город начинается с понятных ежедневных действий.",
    ].join("\n");

    await expect(generatePresentationFromNarrationWithProviders(
      {
        id: "project-script",
        title: "Экология города",
        prompt: "Сделай презентацию про экологию города",
        scenario: "school_report",
        level: "8-11 класс",
        mode: "with_sources",
        slideCount: 2,
      },
      [{ id: "src-1", label: "Prompt", type: "PROMPT", excerpt: "Городская экология зависит от воздуха, транспорта и поведения жителей." }],
      acceptedNarration,
    )).rejects.toThrow("No configured AI provider");
  });

  it("does not use the accepted narration fallback when the configured Yandex call fails", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const studentPrompt = "Подготовь академическую, но легкую для устного выступления студенческую презентацию на 10 слайдов по теме: Карибский кризис. Слайды должны быть короткими.";
    const acceptedNarration = [
      "Слайд 1: Карибский кризис как предел холодной войны",
      "Карибский кризис стал моментом, когда противостояние США и СССР подошло к опасной границе. Размещение ракет и ответные действия сторон создали риск прямого военного столкновения. Важным было не только оружие, но и скорость политических решений. Переговоры помогли остановить эскалацию. Поэтому кризис показывает, насколько важна связь между силой и дипломатией.",
      "",
      "Слайд 2: Итог для международной политики",
      "После кризиса стало очевидно, что ядерное сдерживание требует каналов связи и взаимного контроля. Политические лидеры увидели, что давление без переговоров повышает риск ошибки. Компромисс позволил избежать войны, хотя напряжение между системами не исчезло. Этот опыт повлиял на дальнейшие соглашения о безопасности. Главный вывод в том, что ответственность в кризисе важнее демонстрации силы.",
    ].join("\n");

    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error("Yandex request failed: 503 unavailable"); };
    try {
      await expect(generatePresentationFromNarrationWithProviders(
        {
        id: "project-script",
        title: studentPrompt,
        prompt: studentPrompt,
        scenario: "university_report",
        level: "university_student",
        mode: "with_sources",
        slideCount: 2,
      },
      [{ id: "src-prompt", label: "Prompt", type: "PROMPT", size: 0, excerpt: studentPrompt }],
        acceptedNarration,
      )).rejects.toThrow("AI slide generation failed");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("stores the stable StudyDeck editorial theme across topics", async () => {
    process.env.AI_PROVIDER = "";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const presentation = await generatePresentation(
      {
        id: "project-theme",
        title: "Война и катастрофа",
        prompt: "Сделай презентацию про войну, трагедию и кризис",
        scenario: "school_report",
        level: "8 класс",
        mode: "fast_draft",
        slideCount: 4,
      },
      [{ id: "src-1", label: "Prompt", type: "PROMPT", excerpt: "Материал о тяжелой теме." }],
    );

    expect(presentation.presentationTheme?.themeId).toBe("studydeckEditorial");
    expect(presentation.presentationTheme?.preset).toBe("minimal");
    expect(presentation.presentationTheme?.mood).toBe("serious");
  });

  it("builds one directed scene per slide without triple layout repetition", async () => {
    process.env.AI_PROVIDER = "";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const presentation = await generatePresentation(
      {
        id: "project-visual-rhythm",
        title: "Artificial intelligence in universities",
        prompt: "Explain the context, evidence, risks, comparison, and practical conclusion for university students.",
        scenario: "university_report",
        level: "university_student",
        mode: "with_sources",
        slideCount: 7,
      },
      [{ id: "source-1", label: "Research", type: "WEB", excerpt: "Evidence about adoption, risks, and outcomes." }],
    );

    const directions = presentation.designBrief?.slideDirections || [];
    expect(directions).toHaveLength(7);
    expect(directions[0]?.visualRole).toBe("hero");
    expect(directions.every((direction) => direction.visualPurpose && direction.visualRationale)).toBe(true);
    expect(directions.at(-1)?.visualRole).toBe("summary");
    expect(directions.at(-1)?.imageStrategy).toBe("none");
    const contentDirections = directions.filter((direction) => direction.visualRole !== "hero" && direction.visualRole !== "summary");
    const visualDirections = contentDirections.filter((direction) =>
      direction.imageStrategy === "real_photo" || direction.imageStrategy === "diagram",
    );
    expect(visualDirections.length).toBeGreaterThanOrEqual(Math.ceil(contentDirections.length * 0.6));
    expect(visualDirections.length).toBeLessThanOrEqual(Math.floor(contentDirections.length * 0.75));
    expect(directions.some((direction) => direction.imageStrategy === "diagram")).toBe(true);
    expect(directions.some((direction) => direction.imageStrategy === "none")).toBe(true);
    expect(directions[0]?.sceneTextMode).toBe("hero_phrase");
    expect(directions.at(-1)?.sceneTextMode).toBe("takeaway");
    expect(new Set(directions.map((direction) => direction.sceneTextMode)).size).toBeGreaterThanOrEqual(3);
    for (let index = 2; index < directions.length; index += 1) {
      expect(new Set(directions.slice(index - 2, index + 1).map((item) => item.layoutIntent)).size).toBeGreaterThan(1);
      expect(new Set(directions.slice(index - 2, index + 1).map((item) => item.sceneTextMode)).size).toBeGreaterThan(1);
    }
    for (let index = 2; index < contentDirections.length; index += 1) {
      expect(contentDirections.slice(index - 2, index + 1).some((direction) => direction.imageStrategy !== "none")).toBe(true);
    }
  });

  it("accepts a human study-story deck with semantic titles and concrete details", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = [
      "Слайд 1: За фасадом успеха",
      "Я расскажу о книге «Волк с Уолл-стрит» Джордана Белфорта. На первый взгляд это история большого успеха, где есть деньги, карьера и громкое имя. Но за роскошью постепенно раскрываются обман, зависимость и потеря контроля. Поэтому книга воспринимается не как простая история богатства, а как рассказ о цене быстрых амбиций. Такой заход помогает сразу увидеть конфликт между внешним успехом и внутренним разрушением.",
      "",
      "Слайд 2: Stratton Oakmont и падение",
      "Stratton Oakmont становится символом агрессивных продаж и давления на клиентов. Компания быстро растет, а Белфорт зарабатывает огромные деньги. Но вместе с ростом усиливается ощущение безнаказанности и желание идти дальше. Чем выше он поднимается, тем чаще нарушает закон и рискует чужими деньгами. В итоге успех компании превращается в причину расследования и личного падения.",
      "",
      "Слайд 3: Главные уроки книги",
      "Для меня эта книга - не пример для повторения, а предупреждение. Она показывает, что успех без честности и ответственности быстро превращается в проблему. Белфорт умел говорить, убеждать и вести за собой людей, но использовал эти качества неправильно. Харизма и амбиции полезны только тогда, когда у человека есть принципы. Главный вывод в том, что контролировать нужно не других, а прежде всего самого себя.",
    ].join("\n");
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "За фасадом успеха",
      generatedText: presentationText,
      outline: ["За фасадом успеха", "Stratton Oakmont и падение", "Главные уроки книги"],
      slides: [
        {
          title: "За фасадом успеха",
          thesis: "История Белфорта показывает цену успеха без контроля.",
          blocks: [{ type: "callout", content: "За деньгами и роскошью скрывались обман, зависимость и потеря контроля." }],
        },
        {
          title: "Stratton Oakmont и падение",
          thesis: "Stratton Oakmont стала символом агрессивных продаж и давления на клиентов.",
          bullets: ["Компания быстро росла", "Белфорт нарушал закон", "Расследование привело к ответственности"],
        },
        {
          title: "Главные уроки книги",
          thesis: "Успех без честности быстро превращается в проблему.",
          bullets: ["Нужны принципы", "Важна ответственность", "Харизма требует самоконтроля"],
        },
      ],
      speechScript: [],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "За фасадом успеха",
          prompt: "Сделай презентацию о книге Волк с Уолл-стрит",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 3,
        },
        [{ id: "src-1", label: "Книга", type: "WEB", size: 0, excerpt: "Белфорт, Stratton Oakmont, агрессивные продажи, расследование и ответственность." }],
      );

      expect(presentation.generatedText).toBe(presentationText);
      expect(presentation.narrativePlan).toHaveLength(3);
      expect(presentation.narrativePlan[2].transitionToNext).toBe("");
      expect(presentation.slides).toHaveLength(3);
      expect(presentation.designBrief?.slideDirections).toHaveLength(3);
      expect(presentation.slides[1].layout).toBe("statement");
      expect(presentation.slides.every((slide) => slide.speakerNotes)).toBe(true);
      expect(presentation.speechScript).toHaveLength(3);
      expect(presentation.slides.map((slide) => slide.title)).toEqual([
        "За фасадом успеха",
        "Stratton Oakmont и падение",
        "Главные уроки книги",
      ]);
      expect(presentation.speechScript[2].text).toContain("не пример для повторения");
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("asks the provider to rewrite the full speech after repeated template text", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const badText = [
      "Слайд 1: Телефоны Samsung",
      "Телефоны Samsung открывает тему Телефоны Samsung через общий разговор без настоящего содержания. Главный акцент здесь в том, что телефоны Samsung нужно раскрыть через конкретные факты. Эта часть подводит к следующему фрагменту без резкого перехода. Пользовательский запрос повторяется вместо нормального объяснения. Поэтому рассказ не отвечает на тему, а только имитирует структуру.",
      "",
      "Слайд 2: Контекст и актуальность",
      "Контекст и актуальность продолжает разговор о теме и уточняет главное без фактов. В этой части нужно выделить конкретные факты по теме, но они не названы. Главный акцент здесь снова связан только с формулировкой запроса. Такая речь не дает слушателю новой информации о телефонах. В итоге текст остается шаблоном вместо выступления.",
      "",
      "Слайд 3: Ключевые факты",
      "Ключевые факты продолжает разговор о теме и снова не называет факты. Основной смысл раскрывается через обещание рассказать о Samsung позже. Текст на слайде оставляет только опорные пункты без реального объяснения. Главный акцент здесь повторяет название темы и не развивает мысль. Поэтому такой ответ должен быть отклонен как шаблонный.",
    ].join("\n");
    const originalFetch = global.fetch;
    const rewrittenText = narrationForSlides(["Телефоны Samsung", "Развитие линейки Galaxy", "Вывод о бренде"]);
    mockYandexNarrationRewrite(badText, rewrittenText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Телефоны Samsung",
          prompt: "Сделай презентацию про телефоны Samsung",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 3,
        },
        [{ id: "src-1", label: "Samsung", type: "WEB", size: 0, excerpt: "Материал о линейке Samsung Galaxy." }],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expect(presentation.generatedText).toBe(rewrittenText);
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects empty AI output instead of creating production fallback slides", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const originalFetch = global.fetch;
    global.fetch = async () => yandexTextResponse("");

    try {
      await expect(
        generatePresentation(
          {
            id: "project-1",
            title: "Пустой ответ",
            prompt: "Сделай презентацию про пустой ответ модели",
            scenario: "lesson",
            level: "beginner",
            mode: "with_sources",
            slideCount: 4,
          },
          [{ id: "src-1", label: "Материал", type: "WEB", size: 0, excerpt: "Нужен полноценный текст." }],
        ),
      ).rejects.toThrow("did not include text");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("runs Yandex speech-first generation and builds slides from generatedText", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = [
      "Слайд 1: За фасадом успеха",
      "Я расскажу о том, как внешний успех может скрывать потерю контроля. В начале важно увидеть не только деньги и статус, но и цену, которую человек платит за быстрый рост. Такой заход задает тему всей презентации. Он помогает перейти к причинам и последствиям без резкого скачка. Поэтому первый фрагмент сразу показывает личную цену быстрого роста.",
      "",
      "Слайд 2: Главный вывод",
      "В финале эта история становится предупреждением. Успех без честности быстро превращается в проблему. Харизма и амбиции полезны только тогда, когда у человека есть принципы. Поэтому главный вывод связан с ответственностью за собственные решения. Такой итог помогает не повторять чужие ошибки.",
    ].join("\n");
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    mockYandexTwoStep(
      presentationText,
      {
        title: "За фасадом успеха",
        generatedText: presentationText,
        outline: ["За фасадом успеха", "Главный вывод"],
        slides: [
          {
            title: "За фасадом успеха",
            thesis: "Внешний успех может скрывать потерю контроля.",
            blocks: [{ type: "callout", content: "За деньгами и статусом может стоять высокая личная цена." }],
          },
          {
            title: "Главный вывод",
            thesis: "Успех без честности быстро превращается в проблему.",
            bullets: ["Нужны принципы", "Важна ответственность", "Амбиции требуют контроля"],
          },
        ],
        speechScript: [],
      },
      bodies,
    );

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "За фасадом успеха",
          prompt: "Сделай презентацию о цене быстрого успеха",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 2,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "A story about success and responsibility." }],
      );

      expect(bodies).toHaveLength(4);
      expect(bodies[0].json_schema?.schema).toBeTruthy();
      expect(bodies[0].messages[1].text).toContain("narrativePlan");
      expect(bodies[1].json_object).toBeUndefined();
      expect(bodies[1].messages[1].text).toContain("Narrative plan to follow exactly");
      expect(bodies[1].messages[1].text).toContain("3-7 complete sentences");
      expect(bodies[1].messages[1].text).toContain("one continuous speech");
      expect(bodies[1].messages[1].text).toContain("read the result word for word");
      expect(bodies[2].json_schema?.schema).toBeTruthy();
      expect(bodies[2].messages[1].text).toContain("Deck story");
      expect(bodies[2].messages[1].text).toContain("Slide text plans");
      expect(bodies[2].messages[1].text).toContain("Do not output raw CSS");
      expect(bodies[2].messages[1].text).toContain("Choose imageStrategy independently for every slide");
      expect(bodies[2].messages[1].text).toContain("Choose sceneTextMode for every slide");
      expect(bodies[2].messages[1].text).toContain("Never request a random stock image");
      expect(bodies[2].messages[1].text).toContain("50-70 percent");
      expect(bodies[2].messages[1].text).toContain("Never place text over an image");
      expect(bodies[3].json_object).toBe(true);
      expect(bodies[3].json_schema).toBeUndefined();
      expect(bodies[3].messages[1].text).toContain(presentationText);
      expect(bodies[3].messages[1].text).toContain("only source of truth");
      expect(bodies[3].messages[1].text).toContain("narrativePlan");
      expect(bodies[3].messages[1].text).toContain("researchBrief");
      expect(bodies[3].messages[1].text).toContain("designBrief");
      expect(bodies[3].messages[1].text).toContain("slideBlueprints");
      expect(presentation.generatedText).toBe(presentationText);
      expect(presentation.designBrief?.slideDirections).toHaveLength(2);
      expect(presentation.designBrief?.slideDirections[0].imageStrategy).toBe("real_photo");
      expect(presentation.designBrief?.slideDirections[0].sceneTextMode).toBe("visual_labels");
      expect(presentation.presentationTheme?.themeId).toBe("editorialMagazine");
      expect(presentation.slides[0].thesis).toContain("Внешний успех");
      expect(presentation.slides[1].bullets.every((bullet) => bullet.trim().length > 0)).toBe(true);
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("accepts numbered Yandex narration sections and normalizes them for review", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const numberedNarration = [
      "### 1. Главная волна девяностых",
      "Русские песни девяностых часто звучали как дневник времени, в котором смешивались свобода, тревога и надежда. После распада СССР музыкальный рынок быстро менялся, и новые группы получили возможность говорить с аудиторией напрямую. Популярная музыка стала ближе к повседневной жизни, потому что в ней слышались дворы, кассеты, телепередачи и первые коммерческие радиостанции. Для слушателей эти песни были не только развлечением, но и способом узнать собственные переживания. Поэтому разговор о девяностых начинается с ощущения резкой перемены, которая вошла в музыку.",
      "",
      "**2) Память и вывод**",
      "Сегодня песни девяностых воспринимаются как культурная память о сложном десятилетии. Одни композиции напоминают о романтике свободы, другие сохраняют чувство неустойчивости и поиска. Важным стало то, что разные жанры существовали рядом: рок, поп, танцевальная музыка и авторская интонация спорили за внимание слушателя. Такое разнообразие показывает, что эпоха не сводилась к одному настроению или одному стилю. В итоге музыка девяностых осталась узнаваемой, потому что передала голос людей на переломе истории.",
    ].join("\n");
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return yandexTextResponse(
          JSON.stringify(narrativePlanForTitles(["Главная волна девяностых", "Память и вывод"])),
        );
      }
      return yandexTextResponse(numberedNarration);
    };

    try {
      const draft = await generateNarrationDraft(
        {
          id: "project-1",
          title: "Русские песни 90 х",
          prompt: "Сделай презентацию про русские песни 90 х",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 2,
        },
        [{ id: "src-1", label: "Prompt", type: "PROMPT", size: 0, excerpt: "Русская музыка девяностых отражала перемены общества." }],
      );

      expect(draft.text.match(/Слайд\s+\d+\s*:/g)).toHaveLength(2);
      expect(draft.text).toContain("Слайд 1: Главная волна девяностых");
      expect(draft.text).toContain("Слайд 2: Память и вывод");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("asks Yandex to rewrite the full speech when a section is too short", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const shortText = [
      "Слайд 1: За фасадом успеха",
      "История начинается с внешнего успеха. Но за ним быстро появляется потеря контроля. Поэтому тема звучит как предупреждение.",
      "",
      "Слайд 2: Главный вывод",
      "Финал показывает цену безответственности. Успех без принципов становится проблемой.",
    ].join("\n");
    const repairedText = [
      "Слайд 1: За фасадом успеха",
      "История начинается с внешнего успеха, который выглядит ярко и убедительно. Но за этим успехом быстро появляется потеря контроля. Деньги и статус начинают менять поведение героя сильнее, чем он сам замечает. Поэтому тема звучит как предупреждение о цене быстрых побед. Эта часть открывает рассказ через контраст между блеском и внутренним разрушением.",
      "",
      "Слайд 2: Главный вывод",
      "Финал показывает, что безответственность постепенно разрушает даже сильный внешний успех. Успех без принципов становится проблемой для самого человека и для тех, кто рядом. Важен не только результат, но и способ, которым человек к нему приходит. Если путь построен на обмане, победа быстро превращается в долг и наказание. Поэтому главный вывод связан с самоконтролем, честностью и ответственностью.",
    ].join("\n");
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    let callCount = 0;
    let narrationCalls = 0;
    global.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      bodies.push(body);
      callCount += 1;
      if (callCount === 1) {
        return yandexTextResponse(
          JSON.stringify(narrativePlanForTitles(["Р—Р° С„Р°СЃР°РґРѕРј СѓСЃРїРµС…Р°", "Р“Р»Р°РІРЅС‹Р№ РІС‹РІРѕРґ"])),
        );
      }
      if (String(body.messages?.[0]?.text || "").includes("full Russian oral narration")) {
        narrationCalls += 1;
        return yandexTextResponse(narrationCalls === 1 ? shortText : repairedText);
      }
      return yandexTextResponse(
        JSON.stringify({
          title: "За фасадом успеха",
          generatedText: repairedText,
          outline: ["За фасадом успеха", "Главный вывод"],
          slides: [
            {
              title: "За фасадом успеха",
              thesis: "Внешний успех может скрывать потерю контроля.",
              blocks: [{ type: "callout", content: "За быстрым ростом появляется личная цена." }],
            },
            {
              title: "Главный вывод",
              thesis: "Быстрый успех без принципов легко превращается в проблему.",
              bullets: ["Нужны принципы", "Важен самоконтроль", "Ответственность важнее статуса"],
            },
          ],
          speechScript: [],
        }),
      );
    };

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "За фасадом успеха",
          prompt: "Сделай презентацию о цене быстрого успеха",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 2,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "A story about success and responsibility." }],
      );

      expect(bodies).toHaveLength(5);
      expect(bodies[0].json_schema?.schema).toBeTruthy();
      expect(bodies[1].json_object).toBeUndefined();
      expect(bodies[2].messages[1].text).toContain("completely new, coherent report");
      expect(bodies[3].json_schema?.schema).toBeTruthy();
      expect(bodies[4].json_object).toBe(true);
      expect(bodies[4].json_schema).toBeUndefined();
      expect(bodies[4].messages[1].text).toContain("only source of truth");
      expect(presentation.generatedText).toBe(repairedText);
      expect(sentenceCount(presentation.speechScript[0].text)).toBe(5);
      expect(sentenceCount(presentation.speechScript[1].text)).toBe(5);
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rewrites the full narration when neighboring slides repeat a closing sentence", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const repeatedText = [
      "Слайд 1: Начало истории",
      "История начинается с первого заметного события. Оно задает конфликт и показывает главного участника. Затем появляется причина, которая меняет ход рассказа. Поэтому слушатель видит основу дальнейших событий. Финальная мысль кратко собирает смысл этих событий.",
      "",
      "Слайд 2: Развитие конфликта",
      "Конфликт становится сильнее после нового решения героя. Это решение влияет на других участников истории. Последствия уже нельзя объяснить одной случайностью. Так рассказ переходит от завязки к более серьезной проблеме. Финальная мысль кратко собирает смысл этих событий.",
    ].join("\n");
    const originalFetch = global.fetch;
    const rewrittenText = narrationForSlides(["Начало истории", "Развитие конфликта"]);
    mockYandexNarrationRewrite(repeatedText, rewrittenText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "История",
          prompt: "Сделай презентацию про развитие конфликта",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 2,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Conflict story excerpt." }],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      const acceptedSections = parseNarrationSections(presentation.generatedText);
      expect(acceptedSections.map((section) => section.text)).toEqual(parseNarrationSections(rewrittenText).map((section) => section.text));
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rewrites the full narration when many slides repeat the same opening phrase", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const repeatedText = [
      "Слайд 1: Первые изменения",
      "Главная мысль здесь связана с тем, что кино стало разнообразнее. Онлайн-платформы изменили путь фильма к зрителю. Авторские драмы стали заметнее рядом с коммерческими проектами. Зрители начали чаще смотреть премьеры дома. Поэтому рынок стал более подвижным.",
      "",
      "Слайд 2: Новые привычки",
      "Главная мысль здесь связана с тем, что зрители стали выбирать формат просмотра свободнее. Домашние премьеры перестали быть редким исключением. Платформы начали конкурировать с кинотеатрами за внимание аудитории. Жанры стали быстрее находить своих зрителей. Поэтому привычки просмотра заметно изменились.",
      "",
      "Слайд 3: Итог",
      "Главная мысль здесь связана с тем, что индустрия стала зависеть от разных способов показа. Фестивальное кино получило новые возможности. Коммерческие проекты тоже начали активнее работать с онлайн-аудиторией. Это сделало рынок сложнее и разнообразнее. Поэтому современное кино нельзя объяснить только кинотеатрами.",
    ].join("\n");

    const originalFetch = global.fetch;
    const rewrittenText = narrationForSlides(["Первые изменения", "Новые привычки", "Итог индустрии"]);
    mockYandexNarrationRewrite(repeatedText, rewrittenText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 3,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expect(presentation.generatedText).toBe(rewrittenText);
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("fails safely when the Yandex rewrite still has repeated narration", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const titles = Array.from({ length: 14 }, (_, index) => `Repair topic ${index + 1}`);
    const overlongText = overlongNarrationForSlides(titles);
    const rewrittenText = titles
      .map((title, index) => [
        `Слайд ${index + 1}: ${title}`,
        `Openingpoint${index + 1} explains a concrete part of the report with enough context for the listener. The supporting example for item ${index + 1} shows how this point works in practice. Closingpoint${index + 1} preserves the evidence while keeping the spoken explanation concise and distinct.`,
      ].join("\n"))
      .join("\n\n");
    const rewrittenNarration = narrationForSlides(titles);
    const originalFetch = global.fetch;
    mockYandexNarrationRewrite(overlongText, rewrittenNarration);

    try {
      await expect(generatePresentation(
        {
          id: "project-1",
          title: "Narration repair",
          prompt: "Create a presentation about narration repair",
          scenario: "school_report",
          level: "8 class",
          mode: "with_sources",
          slideCount: 14,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Narration repair keeps each section concise and specific." }],
      )).rejects.toThrow("narration_quality_failure");
      return;

    } finally {
      global.fetch = originalFetch;
    }
  });

  it("refuses overlong narration when the provider does not return a valid rewrite", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const titles = ["Repair topic 1", "Repair topic 2"];
    const weakText = weakOverlongNarrationForSlides(titles);
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = async () => {
      callCount += 1;
      return callCount === 1
        ? yandexTextResponse(JSON.stringify(narrativePlanForTitles(titles)))
        : yandexTextResponse(weakText);
    };

    try {
      await expect(
        generatePresentation(
          {
            id: "project-1",
            title: "Narration repair",
            prompt: "Create a presentation about narration repair",
            scenario: "school_report",
            level: "8 class",
            mode: "with_sources",
            slideCount: 2,
          },
          [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Narration repair keeps each section concise and specific." }],
        ),
      ).rejects.toThrow("AI generation failed. yandex: narration_quality_failure");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects incomplete AI output instead of filling production slides with fallback", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const originalFetch = global.fetch;
    global.fetch = async () =>
      yandexTextResponse(
        [
          "Слайд 1: Process overview",
          "A process is easier to understand when it is split into steps. The first point gives the listener a simple starting place. The second point shows why order matters. The third point connects the steps with the final result. This narration intentionally omits the other requested slides.",
        ].join("\n"),
      );

    try {
      await expect(
        generatePresentation(
          {
            id: "project-1",
            title: "Structured topic",
            prompt: "Explain a process",
            scenario: "lesson",
            level: "beginner",
            mode: "with_sources",
            slideCount: 3,
          },
          [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "A process has ordered steps." }],
        ),
      ).rejects.toThrow("narration_quality_failure");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("fails safely when Yandex structured JSON omits requested slides", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const titles = ["Alfa Romeo introduction", "Brand history", "Motorsport legacy"];
    const presentationText = narrationForSlides(titles);
    const partialText = presentationText.split("\n\n")[0];
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      callCount += 1;
      if (callCount === 1) return yandexTextResponse(JSON.stringify(narrativePlanForTitles(titles)));
      if (callCount === 2) return yandexTextResponse(presentationText);
      if (callCount === 3) return yandexTextResponse(JSON.stringify(designBriefForTitles(titles)));
      return yandexTextResponse(
        JSON.stringify({
          title: "Alfa Romeo",
          generatedText: partialText,
          outline: [titles[0]],
          slides: [
            {
              title: titles[0],
              thesis: "Alfa Romeo is introduced through concrete brand context.",
              bullets: ["Italian design", "Sporting identity"],
              speakerNotes: partialText,
            },
          ],
          speechScript: [{ slideOrder: 1, slideTitle: titles[0], text: partialText }],
        }),
      );
    };

    try {
      await expect(generatePresentation(
        {
          id: "project-alfa",
          title: "Alfa Romeo",
          prompt: "Create a university presentation about Alfa Romeo",
          scenario: "school_report",
          level: "university",
          mode: "with_sources",
          slideCount: 3,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Alfa Romeo has a long sporting and design history." }],
      )).rejects.toThrow("Yandex structured presentation recovery chunk 1");
      expect(bodies.length).toBeGreaterThanOrEqual(5);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("hides weak visual blocks and keeps useful structured visuals", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = narrationForSlides([
      "Визуальная логика",
      "Пустая схема",
      "Неполное сравнение",
      "Полезный процесс",
      "Что считать качеством",
    ]);
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Visual quality",
      generatedText: presentationText,
      slides: [
        {
          title: "Визуальная логика",
          thesis: "Визуальный блок нужен только там, где он помогает понять мысль.",
        },
        {
          title: "Пустая схема",
          thesis: "Схема без узлов не объясняет тему.",
          bullets: ["Узлы обозначают ключевые понятия", "Связи показывают отношения между ними"],
          visual: { type: "schema", title: "Schema" },
        },
        {
          title: "Неполное сравнение",
          thesis: "Сравнение работает только тогда, когда у него есть две стороны.",
          bullets: ["Критерии должны быть одинаковыми", "Обе стороны требуют содержательных значений"],
          visual: { type: "comparison_diagram", rows: [{ label: "Only one side", left: "First value", right: "" }] },
        },
        {
          title: "Полезный процесс",
          thesis: "Процесс помогает, когда у него есть понятные шаги.",
          bullets: ["Шаги располагаются в правильном порядке", "Каждое действие получает краткое объяснение"],
          visual: {
            type: "process_diagram",
            items: [
              { label: "Collect material", text: "Gather the key facts." },
              { label: "Explain result", text: "Turn facts into a short explanation." },
            ],
          },
        },
        {
          title: "Что считать качеством",
          thesis: "Визуальный блок должен быть связан с мыслью слайда.",
          bullets: ["Блок не должен быть пустым", "Сравнение требует двух сторон", "Процесс требует шагов"],
        },
      ],
    }, undefined, {
      slides: [
        {
          slideOrder: 5,
          thesis: "Визуальный блок должен быть связан с основной мыслью материала.",
          bullets: ["Блок не должен быть пустым", "Сравнение требует двух сторон", "Процесс требует шагов"],
          blocks: [
            {
              type: "bullets",
              items: ["Блок не должен быть пустым", "Сравнение требует двух сторон", "Процесс требует шагов"],
            },
          ],
          definition: null,
          visual: {
            title: "",
            items: [],
            rows: [],
            leftLabel: "",
            rightLabel: "",
          },
        },
      ],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Visual quality",
          prompt: "Explain when visual blocks are useful",
          scenario: "lesson",
          level: "beginner",
          mode: "with_sources",
          slideCount: 5,
        },
        [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Useful visuals need real structure." }],
      );

      expect(presentation.slides[1].visual.type).toBe("none");
      expect(presentation.slides[2].visual.type).toBe("none");
      expect(presentation.slides[3].visual.type).toBe("process_diagram");
      expect(presentation.slides[3].visual.items).toHaveLength(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("adds section dividers and summary takeaways in structured demo fallback", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.AITUNNEL_API_KEY = "";
    process.env.AI_PROVIDER = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const presentation = await generatePresentation(
      {
        id: "project-1",
        title: "Structured fallback",
        prompt: "Create a structured fallback deck",
        scenario: "lesson",
        level: "beginner",
        mode: "with_sources",
        slideCount: 6,
      },
      [{ id: "src-1", label: "Source", type: "WEB", size: 0, excerpt: "Fallback material." }],
    );

    expect(presentation.slides[0].slideKind).toBe("title");
    expect(presentation.slides.some((slide) => slide.slideKind === "section")).toBe(true);
    expect(presentation.slides[5].slideKind).toBe("summary");
    expect(presentation.slides[5].bullets.length).toBeGreaterThanOrEqual(3);
    expect(presentation.slides[5].bullets.length).toBeLessThanOrEqual(5);
    expect(presentation.slides.every((slide) => slide.keyConcepts.length === 0)).toBe(true);
    expect(presentation.slides.every((slide) => slide.highlights.length === 0)).toBe(true);
    expect(new Set(presentation.slides.map((slide) => slide.layout)).size).toBeGreaterThan(2);
    expect(presentation.slides.map((slide) => slide.layout)).not.toContain("case-study");
    expect(presentation.speechScript.every((item) => sentenceCount(item.text) >= 1 && sentenceCount(item.text) <= 7)).toBe(true);
    expect(presentation.slides.every((slide) => sentenceCount(slide.speakerNotes) >= 1 && sentenceCount(slide.speakerNotes) <= 7)).toBe(true);
    expectNoForbiddenNarration(visiblePresentationText(presentation));
    expectNoForbiddenSlideText(visiblePresentationText(presentation));
  });

  it("repairs generic filler and fragments before saving production output", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = narrationForSlides(["Экология города", "Воздух и транспорт", "Вывод"]);
    const bodies: any[] = [];
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Экология города",
      generatedText: presentationText,
      slides: [
        {
          title: "Экология города",
          thesis: "Экология города зависит от транспорта, воздуха и поведения жителей.",
        },
        {
          title: "Воздух и транспорт",
          thesis: "Космические аппараты исследуют далёкие планеты за пределами Солнечной системы.",
          bullets: [
            "Из презентации можно вынести следующее",
            "Орбитальные станции работают за пределами атмосферы.",
            "Телескопы помогают изучать далёкие галактики.",
            "Ракеты доставляют аппараты на заданную орбиту.",
          ],
          blocks: [
            {
              type: "callout",
              content: "Космические аппараты передают данные о других планетах.",
            },
          ],
          visual: {
            type: "image",
            description: "Как показано на изображении, на картинке есть транспорт.",
          },
        },
        {
          title: "Вывод",
          thesis: "Морские течения определяют температуру глубоких океанов в разных климатических поясах.",
        },
      ],
    }, bodies, {
      slides: [
        {
          slideOrder: 2,
          thesis: "Транспорт загрязняет городской воздух выхлопными газами.",
          bullets: [
            "Общественный транспорт снижает число машин на дорогах.",
            "Зелёные зоны помогают удерживать пыль.",
          ],
          blocks: [
            {
              type: "callout",
              content: "Качество воздуха зависит от транспорта и городского озеленения.",
            },
          ],
          definition: null,
          visual: {
            title: "",
            items: [],
            rows: [],
            leftLabel: "",
            rightLabel: "",
          },
        },
        {
          slideOrder: 3,
          thesis: "Чистый город требует совместных решений жителей и властей.",
          bullets: [
            "Экологичный транспорт уменьшает загрязнение воздуха.",
            "Ответственное поведение жителей поддерживает чистоту города.",
            "Озеленение делает городскую среду комфортнее.",
          ],
          blocks: [
            {
              type: "bullets",
              items: [
                "Экологичный транспорт уменьшает загрязнение воздуха.",
                "Ответственное поведение жителей поддерживает чистоту города.",
                "Озеленение делает городскую среду комфортнее.",
              ],
            },
          ],
          definition: null,
          visual: {
            title: "",
            items: [],
            rows: [],
            leftLabel: "",
            rightLabel: "",
          },
        },
      ],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Экология города",
          prompt: "Сделай презентацию про экологию города",
          scenario: "lesson",
          level: "beginner",
          mode: "with_sources",
          slideCount: 3,
        },
        [],
      );

      const slideRepairRequest = bodies.find((body) => String(body.messages?.[1]?.text || "").includes('"slideOrder":2'));
      expect(slideRepairRequest?.messages[1].text).toContain('"slideOrder":3');
      expectNoForbiddenSlideText(visiblePresentationText(presentation));
      expect(visiblePresentationText(presentation)).not.toContain("Из презентации можно вынести следующее");
      expect(presentation.slides[2].thesis).not.toContain("Морские течения");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses complete narration text when the editorial repair request fails", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = narrationForSlides(["Городской транспорт", "Практический вывод"]);
    const narrativePlan = narrativePlanForTitles(["Городской транспорт", "Практический вывод"]);
    let callCount = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
      callCount += 1;
      if (callCount === 1) return yandexTextResponse(JSON.stringify(narrativePlan));
      if (callCount === 2) return yandexTextResponse(presentationText);
      if (callCount === 3) {
        return yandexTextResponse(JSON.stringify(designBriefForTitles(narrativePlan.map((item) => item.slideTitle))));
      }
      if (callCount === 4) {
        return yandexTextResponse(
          JSON.stringify({
            title: "Городской транспорт",
            generatedText: presentationText,
            slides: [
              {
                title: "Городской транспорт",
                thesis: "Городской транспорт влияет на повседневную жизнь жителей.",
              },
              {
                title: "Практический вывод",
                thesis: "Космические телескопы исследуют далёкие галактики за пределами Солнечной системы.",
                bullets: [
                  "Ответственный выбор транспорта уменьшает нагрузку на город",
                  "Общественные маршруты помогают сократить число машин",
                  "Пешеходная инфраструктура делает улицы удобнее",
                ],
              },
            ],
            speechScript: [],
          }),
        );
      }
      return new Response("editor unavailable", { status: 503 });
    };

    try {
      const presentation = await generatePresentation(
        {
          id: "project-editor-fallback",
          title: "Городской транспорт",
          prompt: "Объясни влияние городского транспорта",
          scenario: "lesson",
          level: "beginner",
          mode: "with_sources",
          slideCount: 2,
        },
        [],
      );

      expect(callCount).toBe(5);
      expect(presentation.slides[1].thesis).not.toContain("Космические телескопы");
      expect(presentation.slides[1].thesis).toMatch(/[.!?]$/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rewrites template-like AI narration instead of inserting fallback text", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const originalFetch = global.fetch;
    const templateNarration =
      'Слайд 1: Новая волна\nСлайд "Новая волна" объясняет часть темы "Русское кино" через одну главную мысль: кино стало разнообразнее. Сначала важно разобрать опорный пункт: появились онлайн-платформы. Затем стоит показать связь с другим элементом темы: зрители стали смотреть фильмы иначе. После этого можно закрепить объяснение через деталь: фестивальное кино стало заметнее. Поэтому текст на слайде оставляет только опорные пункты. Основной смысл раскрывается в рассказе про "Новая волна".';

    const rewrittenText = narrationForSlides(["Новая волна"]);
    mockYandexNarrationRewrite(templateNarration, rewrittenText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expect(presentation.generatedText).toBe(rewrittenText);
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rewrites complaint-style universal narration endings", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const badNarration = [
      "Слайд 1: Новая волна",
      "Новая волна российского кино связана с изменением жанров и способов просмотра. Онлайн-платформы сделали путь фильма к зрителю более гибким. Авторские драмы стали заметнее рядом с коммерческими проектами. Так становится понятнее, почему тема «Новая волна» важна именно в этой части рассказа. Связь с разделом «Новая волна» помогает слушателю увидеть не только событие, но и его значение.",
    ].join("\n");

    const originalFetch = global.fetch;
    const rewrittenText = narrationForSlides(["Новая волна"]);
    mockYandexNarrationRewrite(badNarration, rewrittenText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expect(presentation.generatedText).toBe(rewrittenText);
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rewrites direct slide-structure narration phrases", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const badNarration = [
      "Слайд 1: Развитие темы",
      "Дальше раздел «Развитие темы» продолжает тему «Русское кино» и показывает, что кино стало разнообразнее. Сначала важно удержать конкретную мысль: онлайн-платформы изменили путь фильма к зрителю. Следующая деталь добавляет к объяснению новый шаг: авторские драмы стали заметнее рядом с коммерческими проектами. Еще один содержательный момент связан с тем, что зрители стали чаще смотреть фильмы дома. Этот шаг подводит рассказ к следующей части через конкретную мысль о новых жанрах.",
    ].join("\n");

    const originalFetch = global.fetch;
    const rewrittenText = narrationForSlides(["Развитие темы"]);
    mockYandexNarrationRewrite(badNarration, rewrittenText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expect(presentation.generatedText).toBe(rewrittenText);
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rewrites repeated fallback-like sentence formulas in narration", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const badNarration = [
      "Слайд 1: Онлайн-платформы",
      "Онлайн-платформы изменили то, как зрители смотрят российское кино. Это проявляется в том, что премьеры стали чаще выходить не только в кинотеатрах. Причина такого вывода в том, что зрительские привычки стали гибче. Последствия заметны там, где авторские фильмы находят аудиторию быстрее. Поэтому онлайн-платформы стали важной частью современной киноиндустрии.",
    ].join("\n");

    const originalFetch = global.fetch;
    const rewrittenText = narrationForSlides(["Онлайн-платформы"]);
    mockYandexNarrationRewrite(badNarration, rewrittenText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино",
          prompt: "Сделай презентацию про русское кино",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );
      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expect(presentation.generatedText).toBe(rewrittenText);
      expectNoForbiddenNarration(visiblePresentationText(presentation));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rewrites Alfa-style deterministic formulas instead of showing them to the user", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const badNarration = [
      "Слайд 1: Знакомство с Alfa Romeo",
      'Alfa Romeo — итальянский автомобильный бренд с богатой историей. Он известен спортивными автомобилями и узнаваемым дизайном. Рассказ про авто бренд Alfa Romeo связан с тем, что компания объединяет спорт и элегантность. Эта особенность влияет на объяснение "Рассказ про авто бренд Alfa Romeo". "Знакомство с Alfa Romeo" соединяет два факта: историю марки и её спортивный характер.',
      "",
      "Слайд 2: История марки",
      'Компания появилась в Милане в начале двадцатого века. Автоспорт быстро стал важной частью её репутации. Рассказ про авто бренд Alfa Romeo связан с тем, что гонки влияли на дорожные модели. Этот опыт влияет на объяснение "Рассказ про авто бренд Alfa Romeo". "История марки" соединяет два факта: развитие производства и участие в соревнованиях.',
    ].join("\n");
    const rewrittenText = narrationForSlides(["Знакомство с Alfa Romeo", "История марки"]);
    const originalFetch = global.fetch;
    mockYandexNarrationRewrite(badNarration, rewrittenText);

    try {
      const presentation = await generatePresentation(
        {
          id: "project-alfa",
          title: "Рассказ про авто бренд Alfa Romeo",
          prompt: "Подготовь выступление об истории и особенностях Alfa Romeo",
          scenario: "school_report",
          level: "университет",
          mode: "with_sources",
          slideCount: 2,
        },
        [],
      );

      expect(presentation.generatedText).toBe(rewrittenText);
      expect(presentation.generatedText).not.toContain("влияет на объяснение");
      expect(presentation.generatedText).not.toContain("соединяет два факта");
      expect(presentation.generatedText).not.toContain("Рассказ про авто бренд Alfa Romeo связан с тем");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("reads Yandex completion text from result alternatives", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = [
      "Слайд 1: Intro",
      "Russian cinema changed as online platforms became a normal way to reach viewers. Home premieres gave smaller films another route to their audience. This shift also changed how producers compare theatrical and digital releases. Genre boundaries became more flexible as viewing habits diversified. Together these changes explain why the industry now develops across several distribution models.",
    ].join("\n");
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Russian cinema",
      generatedText: presentationText,
      slides: [{ title: "Intro", blocks: [{ type: "bullets", items: ["A real generated point"] }] }],
      speechScript: [],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Russian cinema",
          prompt: "Create a presentation about Russian cinema",
          scenario: "school_report",
          level: "8-11",
          mode: "with_sources",
          slideCount: 1,
        },
        [
          {
            id: "web-1",
            label: "Source",
            type: "WEB",
            size: 0,
            excerpt: "A source excerpt about Russian cinema.",
          },
        ],
      );

      expect(presentation.generationMode).toBe("yandex");
      expect(presentation.slides[0].blocks).toEqual([{ type: "bullets", items: presentation.slides[0].bullets }]);
      expect(presentation.slides[0].bullets.length).toBeGreaterThanOrEqual(2);
      expect(presentation.slides[0].bullets[0]).toContain("Home premieres");
      expect(presentation.slides[0].bullets).not.toContain(presentation.slides[0].thesis);
      expect(presentation.slides[0].visual.description).toBeTruthy();
      expect(sentenceCount(presentation.speechScript[0].text)).toBeGreaterThanOrEqual(3);
      expect(sentenceCount(presentation.speechScript[0].text)).toBeLessThanOrEqual(7);
      expect(presentation.speechScript[0].text.toLowerCase()).toContain("online platforms");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rebuilds a non-aligned string block from canonical narration", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = narrationForSlides(["Civil society"]);
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Civil society",
      generatedText: presentationText,
      slides: [{
        title: "Civil society",
        blocks: ["Civil society includes organizations and relationships between citizens and the state."],
      }],
      speechScript: [],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-string-block",
          title: "Civil society",
          prompt: "Create a presentation about civil society",
          scenario: "school_report",
          level: "university",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );

      expect(() => presentationSchema.parse(presentation)).not.toThrow();
      expect(presentation.slides[0].blocks).toEqual([{ type: "bullets", items: presentation.slides[0].bullets }]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("allows user-provided topical titles that contain рассказ про", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = [
      "Слайд 1: Рассказ про машины Audi quattro",
      "Audi quattro появился как инженерный ответ на задачу уверенного сцепления в сложных дорожных условиях. Полный привод помог автомобилю лучше распределять тягу между осями и сохранять устойчивость на мокрой или скользкой поверхности. В автоспорте эта технология быстро стала заметным преимуществом, потому что позволяла раньше разгоняться после поворотов. Для серийных автомобилей quattro стал способом объединить безопасность, управляемость и спортивный характер. Поэтому история Audi quattro показывает, как техническое решение из гонок изменило ожидания водителей от повседневных машин.",
    ].join("\n");
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Рассказ про машины Audi quattro",
      generatedText: presentationText,
      slides: [
        {
          title: "Рассказ про машины Audi quattro",
          blocks: [
            {
              type: "callout",
              content:
                "Audi quattro сделал полный привод частью спортивного и повседневного образа марки.",
            },
          ],
        },
      ],
      speechScript: [],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-audi",
          title: "Рассказ про машины Audi quattro",
          prompt: "Рассказ про машины Audi quattro",
          scenario: "school_report",
          level: "8 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [
          {
            id: "web-audi",
            label: "Audi quattro",
            type: "WEB",
            size: 0,
            excerpt: "Audi quattro известен системой полного привода и спортивной историей.",
          },
        ],
      );

      expect(presentation.title).toContain("Audi quattro");
      expect(presentation.generationMode).toBe("yandex");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("uses slide speaker notes as the narration fallback for each concrete slide", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = [
      "Слайд 1: Новая волна российского кино",
      "Новая волна российского кино после 2010 года связана с тем, что фильмы стали разнообразнее по жанрам и способам показа. Рядом с авторскими драмами появились кассовые франшизы и онлайн-премьеры. Зрители начали чаще смотреть кино не только в зале, но и на платформах. Это изменило путь фильма к аудитории и сделало рынок более подвижным. Поэтому современное русское кино стоит рассматривать через связь жанров, технологий и зрительских привычек.",
    ].join("\n");
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Русское кино после 2010 года",
      generatedText: presentationText,
      slides: [
        {
          title: "Новая волна российского кино",
          blocks: [
            {
              type: "callout",
              content:
                "Русское кино после 2010 года стало более разнообразным: рядом с авторскими драмами появились кассовые франшизы и онлайн-премьеры.",
            },
          ],
        },
      ],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино после 2010 года",
          prompt: "Сделай презентацию про русское кино после 2010 года",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 1,
        },
        [],
      );

      expect(sentenceCount(presentation.speechScript[0].text)).toBeGreaterThanOrEqual(5);
      expect(sentenceCount(presentation.speechScript[0].text)).toBeLessThanOrEqual(6);
      expect(presentation.speechScript[0].text).toContain("Новая волна российского кино");
      expect(presentation.speechScript[0].text).not.toContain("Добавлю несколько деталей");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects a truncated Yandex structured deck response instead of creating narration fallback slides", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const titles = ["Porsche origin", "Engineering choices", "Lasting legacy"];
    const originalFetch = global.fetch;
    mockYandexTwoStep(narrationForSlides(titles), "{");

    try {
      await expect(generatePresentationFromNarrationWithProviders(
        {
          id: "project-1",
          title: "Porsche 911 heritage and innovation across generations of sports car engineering and design history worldwide",
          prompt: "Create a presentation about the Porsche 911.",
          scenario: "school_report",
          level: "8-11 class",
          mode: "with_sources",
          slideCount: 3,
        },
        [],
        narrationForSlides(titles),
      )).rejects.toThrow("AI slide generation failed");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("repairs repeated generic slide titles from the generated outline", async () => {
    process.env.AI_PROVIDER = "yandex";
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "yandex-key";
    process.env.YANDEX_FOLDER_ID = "folder-id";
    process.env.YANDEX_MODEL_URI = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    const presentationText = narrationForSlides(["Русское кино после 2010 года", "Онлайн-платформы", "Новые жанры"]);
    const originalFetch = global.fetch;
    mockYandexTwoStep(presentationText, {
      title: "Русское кино после 2010 года",
      outline: ["Русское кино после 2010 года", "Онлайн-платформы", "Новые жанры"],
      slides: [
        { title: "Введение", blocks: [{ type: "callout", content: "Короткое вступление." }] },
        { title: "Введение", blocks: [{ type: "callout", content: "Появились онлайн-премьеры." }] },
        { title: "Введение", blocks: [{ type: "callout", content: "Жанры стали разнообразнее." }] },
      ],
      speechScript: [
        { slideOrder: 1, slideTitle: "Введение", text: "Первый рассказ." },
        { slideOrder: 2, slideTitle: "Введение", text: "Второй рассказ." },
        { slideOrder: 3, slideTitle: "Введение", text: "Третий рассказ." },
      ],
    });

    try {
      const presentation = await generatePresentation(
        {
          id: "project-1",
          title: "Русское кино после 2010 года",
          prompt: "Сделай презентацию про русское кино после 2010 года",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 3,
        },
        [],
      );

      expect(presentation.slides.map((slide) => slide.title)).toEqual([
        "Русское кино после 2010 года",
        "Онлайн-платформы",
        "Новые жанры",
      ]);
      expect(presentation.speechScript.map((item) => item.slideTitle)).toEqual([
        "Русское кино после 2010 года",
        "Онлайн-платформы",
        "Новые жанры",
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws instead of creating demo slides when no AI provider is configured", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.AITUNNEL_API_KEY = "";
    process.env.AI_PROVIDER = "";
    process.env.ALLOW_DEMO_GENERATION = "false";

    await expect(
      generatePresentation(
        {
          id: "project-1",
          title: "Русское кино после 2010 года",
          prompt: "Сделай презентацию про русское кино начиная с 2010 года",
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount: 4,
        },
        [],
      ),
    ).rejects.toThrow("No configured AI provider");
  });

  it("does not put placeholder instructions into dev demo slides", async () => {
    process.env.OPENAI_API_KEY = "";
    process.env.YANDEX_API_KEY = "";
    process.env.YANDEX_FOLDER_ID = "";
    process.env.YANDEX_MODEL_URI = "";
    process.env.AITUNNEL_API_KEY = "";
    process.env.AI_PROVIDER = "";
    process.env.ALLOW_DEMO_GENERATION = "true";

    const presentation = await generatePresentation(
      {
        id: "project-1",
        title: "Русское кино после 2010 года",
        prompt: "Сделай презентацию про русское кино начиная с 2010 года",
        scenario: "school_report",
        level: "8-11 класс",
        mode: "with_sources",
        slideCount: 4,
      },
      [
        {
          id: "web-1",
          label: "Источник о российском кино",
          type: "WEB",
          size: 0,
          excerpt: "После 2010 года российское кино развивалось через фестивальные драмы, успешные франшизы и новые онлайн-платформы.",
          url: "https://example.com/cinema",
        },
      ],
    );

    const visibleText = visiblePresentationText(presentation);
    expect(presentation.generationMode).toBe("demo");
    expect(visibleText).not.toContain("Тезис нужно объяснить");
    expect(visibleText).not.toContain("Проверьте");
    expect(visibleText).not.toContain("Добавьте источник");
    expect(visibleText.toLowerCase()).not.toContain("источник");
    expect(visibleText).not.toContain("Смысл темы понятнее, когда видны причины и последствия.");
    expect(visibleText).not.toContain("понятнее через факты, примеры и последствия.");
    expect(presentation.slides[0].slideKind).toBe("title");
    expect(presentation.slides[presentation.slides.length - 1].slideKind).toBe("summary");
    expect(presentation.slides[presentation.slides.length - 1].bullets.length).toBeGreaterThanOrEqual(3);
    expect(presentation.slides.every((slide) => slide.thesis.length < 240)).toBe(true);
    expect(presentation.slides.every((slide) => sentenceCount(slide.speakerNotes) >= 1 && sentenceCount(slide.speakerNotes) <= 7)).toBe(true);
    expect(presentation.speechScript.every((item) => sentenceCount(item.text) >= 1 && sentenceCount(item.text) <= 7)).toBe(true);
    const speechText = [
      ...presentation.slides.map((slide) => slide.speakerNotes),
      ...presentation.speechScript.map((item) => item.text),
    ].join("\n").toLowerCase();
    for (const fragment of ["раздел", "следующ", "переход", "слайд"]) {
      expect(speechText).not.toContain(fragment);
    }
    expectNoForbiddenNarration(speechText);
  });
});

function visiblePresentationText(presentation: Awaited<ReturnType<typeof generatePresentation>>) {
  return [
    presentation.title,
    presentation.generatedText,
    ...presentation.slides.flatMap((slide) => [
      slide.title,
      slide.thesis,
      slide.speakerNotes,
      ...slide.bullets,
      ...(slide.definition ? [slide.definition.term, slide.definition.text] : []),
      ...slide.keyConcepts.map((item) => item.label),
      slide.visual.title,
      slide.visual.description,
      ...slide.visual.items.flatMap((item) => [item.label, item.text]),
      ...slide.visual.rows.flatMap((row) => [row.label, row.left, row.right]),
      ...slide.highlights.map((item) => item.text),
      ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
    ]),
    ...presentation.speechScript.flatMap((item) => [item.slideTitle, item.text]),
  ].join("\n");
}

function expectNoForbiddenNarration(text: string) {
  const lower = text.toLowerCase();
  for (const fragment of forbiddenNarrationFragments) {
    expect(lower).not.toContain(fragment.toLowerCase());
  }
}

function expectNoForbiddenSlideText(text: string) {
  const lower = text.toLowerCase();
  for (const fragment of forbiddenSlideTextFragments) {
    expect(lower).not.toContain(fragment.toLowerCase());
  }
}

function sentenceCount(text: string) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).length;
}

function firstSentence(text: string) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)[0] || "";
}

function lastSentence(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  return sentences[sentences.length - 1] || "";
}

function sentenceStartKey(text: string) {
  return text.toLowerCase().replace(/[«»"“”'`.,!?;:()[\]{}<>]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
}
