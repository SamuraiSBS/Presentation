import {
    PREMIUM_PRESENTATION_THEME_IDS,
    resolvePresentationTheme,
    type DeckStory,
    type GenerationPipelineArtifacts,
    type ResearchBrief,
    type SlideNarrative,
    type SlideTextPlan,
    type Source
} from "@studydeck/shared";
import { z } from "zod";

type ProjectInput = {
  id: string;
  title: string;
  prompt: string;
  scenario: string;
  level: string;
  mode: string;
  slideCount: number;
};

function creationBriefLines(project: ProjectInput) {
  return isGeneralProject(project)
    ? GENERAL_CREATION_BRIEF_LINES
    : STUDENT_CREATION_BRIEF_LINES;
}

function isGeneralProject(project: ProjectInput) {
  return project.scenario === "general" || project.level === "general";
}

export class StructuredGenerationError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly validationError: unknown,
  ) {
    const detail = validationError instanceof Error ? validationError.message : String(validationError);
    super(`Structured generation for ${schemaName} failed validation: ${detail}`);
    this.name = "StructuredGenerationError";
  }
}

type PromptArtifacts = Partial<Pick<GenerationPipelineArtifacts, "researchBrief" | "deckStory" | "designBrief" | "slideBlueprints" | "slideTextPlans">>;

import { getFloorAwareSpeechTimingSectionBounds, getRussianStudentSpeechTimingBudget } from "@studydeck/shared";
import { GENERAL_CREATION_BRIEF_LINES, STUDENT_CREATION_BRIEF_LINES } from "../constants.js";
import type { AitunnelNarrationTimingReason, FullNarrationSafeDiagnostics } from "../narration/processing.js";
import { cleanMultilineText } from "../utilities.js";

export function buildNarrativePlanPrompt(project: ProjectInput, sources: Source[], _researchBrief?: ResearchBrief) {
  const timingBudget = getRussianStudentSpeechTimingBudget(project);
  return [
    "Верни JSON-объект вида {\"slides\":[...]} с narrativePlan для презентации Lazyum.",
    `Тема и запрос пользователя: ${project.prompt}`,
    `Название проекта: ${project.title}`,
    `Сценарий: ${project.scenario}`,
    `Уровень аудитории: ${project.level}`,
    `Ровно слайдов: ${project.slideCount}`,
    `Режим: ${project.mode}`,
    timingBudget
      ? `Контракт речи: ${timingBudget.label}, ${timingBudget.minMinutes}${timingBudget.maxMinutes === undefined ? "+" : `–${timingBudget.maxMinutes}`} минут; цель ${timingBudget.targetMinutes} минут / ${timingBudget.targetWords} слов. Распредели ${timingBudget.titleWordTarget} слов на обложку, ${timingBudget.contentWordTarget} на каждый содержательный слайд и ${timingBudget.conclusionWordTarget} на вывод.`
      : "",
    creationBriefLines(project),
    `Верни ровно ${project.slideCount} элементов, без markdown и без пояснений.`,
    "Каждый элемент должен иметь строго такой вид:",
    JSON.stringify(
      {
        slideOrder: 1,
        slideTitle: "...",
        slidePurpose: "...",
        keyMessage: "...",
        audienceQuestion: "...",
        transitionToNext: "...",
        bridgeFromPrevious: "...",
        evidenceOrExplanation: "...",
        whyItMatters: "...",
        speechWordTarget: 100,
      },
      null,
      2,
    ),
    "Правила:",
    "- весь текст должен быть на русском;",
    `- slideOrder строго от 1 до ${project.slideCount};`,
    "- slideTitle должен быть смысловым, не шаблонным;",
    "- slidePurpose объясняет роль слайда в выступлении;",
    "- keyMessage содержит главный тезис слайда;",
    "- audienceQuestion формулирует вопрос, на который отвечает слайд;",
    "- transitionToNext объясняет, почему после этого слайда логично перейти к следующему;",
    "- transitionToNext для последнего слайда должен быть пустой строкой;",
    "- последний narrative item — это сильный учебный итог: keyMessage отвечает на главный вопрос темы, slidePurpose требует синтеза предыдущих смысловых шагов, а audienceQuestion (если нужен) идет только после вывода;",
    "- для последнего narrative item заранее задай 2–3 разные supporting conclusions, которые опираются на уже запланированные причины, примеры или последствия; не добавляй новых доказательств;",
    "- не планируй отдельный slide только со словами «Спасибо за внимание», «Вопросы?» или «Мы рассмотрели…»; короткая подпись допустима только после содержательного вывода;",
    "- не писать мета-фразы для пользователя вроде \"этот слайд показывает\";",
    "- не выдумывать точные факты, если их нет в источниках.",
    `Материалы только для внутренней фактологии; не показывать названия источников пользователю:\n${formatSourceText(sources)}`,
  ].join("\n\n");
}

export function buildDesignBriefPrompt(
  project: ProjectInput,
  sources: Source[],
  researchBrief: ResearchBrief,
  narrativePlan: SlideNarrative[],
  deckStory: DeckStory,
  slideTextPlans: SlideTextPlan[],
) {
  const themeIds = ["studydeckEditorial"].join(", ");
  return [
    "Create a Lazyum DesignBrief JSON. You are choosing art direction, not drawing the slides.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Allowed themeId values: ${themeIds}.`,
    creationBriefLines(project),
    "Choose one stable themeId. Do not invent custom theme IDs.",
    "Use studydeckEditorial for every deck. The palette is a stable Lazyum identity; topic variety comes from imagery and composition, not random colors.",
    "Return exactly one slideDirections item for every slide order.",
    "Do not output raw CSS, HTML, coordinates, pixel sizes, or layout code.",
    "Choose visualRole as a scene role: hero, problem, context, explain, compare, sequence, evidence, quote, visual_statement, or summary.",
    "Choose layoutIntent as an art-direction intent: split_image_text, statement, cards, timeline, diagram, comparison, evidence_board, quote_spread, or summary.",
    isGeneralProject(project)
      ? "Build Gamma-like visual rhythm while preserving clarity for the requested audience: strong cover, short text-led moments, image-led scenes only when grounded, diagrams for explanation, evidence support, and a strong final takeaway."
      : "Build Gamma-like visual rhythm while preserving university clarity: strong cover, short text-led moments, image-led scenes only when grounded, diagrams for explanation, evidence support, and a strong final takeaway.",
    "Visible slide text should alternate between one strong phrase, 3-4 short sentence-like fragments, and diagram/photo labels. Full explanation belongs in narration and speaker notes.",
    "Do not repeat the same layoutIntent three times in a row. Do not make every slide a card grid.",
    "Choose sceneTextMode for every slide: hero_phrase, talk_sentences, visual_labels, or takeaway.",
    "Use hero_phrase for the cover, title-like claims, quote spreads, and transition moments; use talk_sentences for 3-4 short spoken beats; use visual_labels for diagrams/photos; use takeaway for the final slide.",
    "Choose imageStrategy independently for every slide: real_photo, diagram, or none. Keep generated_illustration schema-compatible if seen, but do not select it in this version.",
    "For every slide, set visualPurpose to exactly one of photo, diagram, timeline, comparison, metric, or text_only, and add visualRationale explaining why that purpose fits the slide material. Do not assign photo to every slide.",
    "Use real_photo only for a concrete, searchable person, place, object, company, event, artwork, historical scene, laboratory object, product, or environment that makes the idea more memorable.",
    "Use diagram for processes, comparisons, causes and effects, concept maps, timelines, structures, and systems. Diagram slides must be understandable from deterministic shapes and labels without an external image.",
    "Use none for strong theses, abstract claims, thinly sourced topics, reflective moments, and the final takeaway. Never request a random stock image merely to fill space.",
    "Economic standard policy: use at most one real_photo per five slides, rounded up, with a hard maximum of two photos per deck. Use local diagrams for the remaining explanatory slides.",
    "Every real photo must occupy 35-60 percent of the slide in a separate grid column. Never place text over an image.",
    "Keep density low: one strong claim and no more than three short supporting points. Full explanation belongs in speaker notes.",
    "For real_photo or generated_illustration, visualPrompt must be a short, concrete, searchable subject describing visible people, place, object, action, or event. Do not write generic phrases such as 'educational presentation image'.",
    "For diagram, visualPrompt must name the specific process, comparison, causal chain, timeline, or structure to draw. For none, describe the text-led emphasis briefly.",
    "Required JSON shape:",
    JSON.stringify({
      themeId: "studydeckEditorial",
      mood: "serious",
      audienceFit: "...",
      visualMetaphor: "...",
      colorIntent: "...",
      typographyIntent: "...",
      rhythm: {
        titleStyle: "academic",
        density: "medium",
        imageFrequency: "balanced",
        sectionBreaks: true,
      },
      slideDirections: [
        {
          slideOrder: 1,
          visualRole: "hero",
          layoutIntent: "split_image_text",
          imageStrategy: "real_photo",
          visualPurpose: "photo",
          visualRationale: "A concrete documentary scene helps the audience observe the setting.",
          sceneTextMode: "hero_phrase",
          visualPrompt: "...",
        },
      ],
    }, null, 2),
    `Narrative plan:\n${formatNarrativePlanForPrompt(narrativePlan)}`,
    `Deck story:\n${JSON.stringify(deckStory, null, 2)}`,
    `Slide text plans:\n${JSON.stringify(slideTextPlans, null, 2)}`,
    `Research brief:\n${JSON.stringify(researchBrief, null, 2)}`,
    `Source excerpts for grounding:\n${formatSourceText(sources)}`,
  ].join("\n\n");
}

export function buildNarrationPrompt(project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[] = [], researchBrief?: ResearchBrief) {
  const planText = formatNarrativePlanForPrompt(narrativePlan);
  const timingBudget = getRussianStudentSpeechTimingBudget(project);
  return [
    "Write the complete speech text for a Lazyum presentation.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Mode: ${project.mode}`,
    creationBriefLines(project),
    researchBrief ? `Research brief to use for factual grounding:\n${JSON.stringify(researchBrief, null, 2)}` : "",
    planText ? `Narrative plan to follow exactly:\n${planText}` : "",
    "Output format:",
    "- plain text only;",
    "- exactly one section per slide;",
    "- every section starts with `Слайд N: semantic title`;",
    "- N must run from 1 through the exact slide count without gaps;",
    "- after each title line, write 3-7 complete sentences; vary the count naturally instead of padding every slide to the same size;",
    timingBudget
      ? `- use the fixed Russian spoken-rate budget of ${timingBudget.wordsPerMinute} words/minute: ${timingBudget.minWords}${timingBudget.maxWords === undefined ? "+" : `-${timingBudget.maxWords}`} words total (${timingBudget.minMinutes}${timingBudget.maxMinutes === undefined ? "+" : `-${timingBudget.maxMinutes}`} minutes); target ${timingBudget.targetWords} words (${timingBudget.targetMinutes} minutes); title ${timingBudget.titleWordTarget}, content ${timingBudget.contentWordTarget}, conclusion ${timingBudget.conclusionWordTarget} words;`
      : "- target roughly 45-90 spoken words per slide and about 35-55 seconds of reading time per slide;",
    "- do not use bullet lists, markdown, JSON, citations, source names, or comments.",
    isGeneralProject(project) ? "Speech rules:" : "University speech rules:",
    isGeneralProject(project)
      ? "- write as a prepared presenter: natural, confident, easy to read aloud, and professional without bureaucratic wording;"
      : "- write as a prepared university student: natural, confident, easy to read aloud, and professional without bureaucratic wording;",
    "- compose the whole answer as one continuous speech before splitting it into slide sections;",
    isGeneralProject(project)
      ? "- the presenter must be able to read the result word for word, with no rewriting or improvised connective phrases;"
      : "- the student must be able to read the result word for word, with no rewriting or improvised connective phrases;",
    "- the first section naturally establishes the subject and central question; do not begin with `Сегодня я расскажу`, `На этом слайде`, or another presentation cliché;",
    "- middle sections must grow out of the previous idea through facts, causes, contrasts, consequences, or chronology, without announcing a transition;",
    "- the last section must answer the central question with a real conclusion or judgment instead of repeating the slide list;",
    "- every section must explain the real topic, not the slide object;",
    "- every section must include at least one concrete detail, example, reason, consequence, contrast, or definition;",
    "- keep the full explanation in narration; visible slide text will be compressed later;",
    "- prefer a compact, substantive explanation inside the allowed range to weak repetition, filler transitions, or meta-commentary; if a section needs more substance, rewrite it naturally from the grounded argument rather than padding it with local words;",
    "- make neighboring openings and endings different in wording and rhythm;",
    isGeneralProject(project)
      ? "- make the final section a human, topic-focused conclusion tied to the topic."
      : "- make the final section a human university-level conclusion tied to the topic.",
    "Narrative plan rules:",
    "- every generatedText section must correspond to one narrativePlan element;",
    "- the section title must match or closely follow slideTitle;",
    "- each section must answer audienceQuestion;",
    "- each section must develop keyMessage;",
    "- each content section must realize bridgeFromPrevious, evidenceOrExplanation, and whyItMatters as natural content rather than labels or meta commentary;",
    "- follow transitionToNext by meaning, but never write mechanical phrases like `перейдем к следующему слайду`.",
    "Style model:",
    isGeneralProject(project)
      ? "- close to a clear, well-prepared presentation: direct, substantive, and easy to read aloud;"
      : "- close to a university student report: direct, academic without stiffness, and easy to read aloud;",
    "- build one continuous report by meaning only: never explain that one slide, section, or paragraph connects to another;",
    "- each paragraph should explain the real topic, not the slide as an object;",
    "- start and finish neighboring paragraphs differently; do not reuse the same sentence pattern across slides;",
    "- use concrete facts from the material when available: names, events, organizations, causes, consequences, comparisons, examples;",
    "- if a slide needs extra sentences, add real content: cause, consequence, conflict, example, change, or conclusion from the topic;",
    "- make the final slide a human conclusion, for example `Для меня эта книга - не пример для повторения, а предупреждение`, only when that fits the topic;",
    "- keep the language natural and readable aloud.",
    "Hard bans:",
    "- do not write phrases like `нужно раскрыть через конкретные факты`, `этот слайд помогает`, `текст на слайде`, `опорные пункты`, or `основной смысл раскрывается`;",
    "- do not write phrases like `Дальше раздел`, `Сначала важно удержать конкретную мысль`, `Следующая деталь добавляет к объяснению новый шаг`, or `Этот шаг подводит рассказ к следующей части`;",
    "- do not mention transitions, neighboring slides, next sections, or how parts of the presentation connect; make the content itself connected;",
    "- write directly: instead of `Дальше раздел показывает...`, write `После первых успехов проблема становится заметнее...`;",
    "- never write universal endings like `Так становится понятнее, почему тема ... важна именно в этой части рассказа`, `Связь с разделом ... помогает слушателю увидеть не только событие, но и его значение`, or `Без этого уточнения дальнейший вывод...`;",
    "- do not write about `почему раздел важен`, `связь с разделом`, or `значение события` unless those exact ideas are real facts of the topic;",
    "- do not invent precise facts, dates, names, numbers, images, or examples when the source material does not support them;",
    "- do not repeat the user request as the speech text.",
    "- do not use unsupported promotional labels such as unique, iconic, benchmark, or revolutionary without factual context.",
    `Source material for internal factual grounding only; do not show source labels to the user:\n${formatSourceText(sources)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * v6 candidate: one complete speech, grounded by a deliberately small but
 * complete plan/snapshot. Its size is bounded for deterministic catalog
 * preflight; it never emits user text to logs.
 */
export function buildAitunnelFullNarrationCandidatePrompt(project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[]) {
  const timing = getRussianStudentSpeechTimingBudget(project);
  const plan = compactFullNarrationPlan(narrativePlan);
  const snapshot = compactFullNarrationSourceSnapshot(sources);
  return [
    isGeneralProject(project)
      ? "Write one complete Russian speech for a Lazyum presentation, not a plan or commentary."
      : "Write one complete Russian university speech for a Lazyum presentation, not a plan or commentary.",
    `Topic and user request: ${cleanMultilineText(project.prompt).slice(0, 240)}.`,
    `Project title: ${cleanMultilineText(project.title).slice(0, 120)}. Exact slide count: ${project.slideCount}.`,
    `Return exactly ${project.slideCount} ordered sections. Each section must start with \`\u0421\u043b\u0430\u0439\u0434 N: semantic title\`, followed by natural spoken prose.`,
    timing ? `The whole speech must contain ${timing.minWords}-${timing.maxWords} words; target ${timing.targetWords}. The shared ${timing.titleWordTarget}/${timing.contentWordTarget}/${timing.conclusionWordTarget} slide targets are soft distribution guidance, not independent hard gates.` : "Write a complete, naturally paced speech.",
    "Develop the argument as one coherent report before returning it. Explain definitions, mechanisms, causes, consequences, examples, limitations, and conclusions where useful.",
    "When the snapshot lacks a precise anchor, cautious general educational explanation is allowed. Do not invent exact names, dates, statistics, quotations, citations, or source labels.",
    "Use natural Russian that can be read aloud. Do not use markdown, JSON, provider commentary, planning formulas, prompt echoes, filler, or references to slides as objects.",
    "Before returning, count and review the whole response: include every heading exactly once, preserve the complete argument, and keep the total within the requested range.",
    plan.length ? `Fixed compact narrative plan:\n${JSON.stringify(plan)}` : "",
    snapshot.length ? `Bounded factual source snapshot (internal grounding only; never cite it):\n${JSON.stringify(snapshot)}` : "Use cautious general educational explanation only.",
  ].filter(Boolean).join("\n\n");
}

/** The v6 Flash loop receives the prior complete draft and only safe local diagnostics. */
export function buildAitunnelFullNarrationRewriteWithDraftPrompt(
  project: ProjectInput,
  _sources: Source[],
  narrativePlan: SlideNarrative[],
  previousDraft: string,
  diagnostics: FullNarrationSafeDiagnostics,
) {
  const timing = getRussianStudentSpeechTimingBudget(project);
  const plan = compactFullNarrationRewritePlan(narrativePlan);
  return [
    isGeneralProject(project)
      ? "Rewrite the complete Russian speech below. Return only a fresh complete speech, never commentary."
      : "Rewrite the complete Russian university speech below. Return only a fresh complete speech, never commentary.",
    `Return all ${project.slideCount} sections in order, each headed \`\u0421\u043b\u0430\u0439\u0434 N: semantic title\`. ${timing ? `Whole-speech contract: ${timing.minWords}-${timing.maxWords} words; target ${timing.targetWords}.` : ""}`,
    "Keep useful content, correct the listed defects, and redistribute detail across the whole argument. Cautious general educational explanation is allowed; do not invent precise facts or citations.",
    `Private diagnostics:\n${JSON.stringify(compactFullNarrationDiagnostics(diagnostics, diagnostics.sectionWordCounts.map((_count, index) => index + 1)))}`,
    plan.length ? `Compact slide plan:\n${JSON.stringify(plan)}` : "",
    `Previous complete draft to rewrite:\n${cleanMultilineText(previousDraft)}`,
  ].filter(Boolean).join("\n\n");
}

export const aitunnelTargetedNarrationRepairResponseSchema = z.object({
  replacements: z.record(z.string().regex(/^(?:[1-9]|10)$/), z.string().min(1)),
}).strict();
export type AitunnelTargetedNarrationRepairResponse = z.infer<typeof aitunnelTargetedNarrationRepairResponseSchema>;

/**
 * v6 has exactly one batch repair. The provider returns only requested,
 * complete headed sections, so Prompt 18.2 can merge by exact slide order.
 */
export function buildAitunnelTargetedNarrationRepairPrompt(
  project: ProjectInput,
  _sources: Source[],
  narrativePlan: SlideNarrative[],
  currentDraft: string,
  diagnostics: FullNarrationSafeDiagnostics,
) {
  const orders = [...new Set(diagnostics.affectedSlideOrders)].sort((a, b) => a - b);
  if (!orders.length) throw new Error("aitunnel_targeted_repair_requires_affected_slides");
  const plan = compactFullNarrationRewritePlan(narrativePlan).filter((item) => orders.includes(item.slideOrder));
  const problemSections = extractRequestedNarrationSections(currentDraft, orders);
  return [
    isGeneralProject(project)
      ? "Repair only the requested sections of this Russian speech. Do not add commentary or return any unrequested slide."
      : "Repair only the requested sections of this Russian university speech. Do not add commentary or return any unrequested slide.",
    `Requested slide orders: ${orders.join(", ")}.`,
    "Return JSON only in this exact shape: {\"replacements\":{\"N\":\"\u0421\u043b\u0430\u0439\u0434 N: semantic title\\ncomplete replacement prose\"}}. Return each requested order exactly once as a key and no other order.",
    "Every replacement must be complete, natural spoken Russian. Cautious general educational explanation is allowed; never invent precise facts or citations.",
    `Private diagnostics:\n${JSON.stringify(compactFullNarrationDiagnostics(diagnostics, orders))}`,
    plan.length ? `Requested plan entries:\n${JSON.stringify(plan)}` : "",
    `Requested current sections only:\n${problemSections}`,
  ].filter(Boolean).join("\n\n");
}

function compactFullNarrationPlan(narrativePlan: SlideNarrative[]) {
  return narrativePlan.slice(0, 10).map((item) => ({
    slideOrder: item.slideOrder,
    slideTitle: cleanMultilineText(item.slideTitle).slice(0, 25),
    slidePurpose: cleanMultilineText(item.slidePurpose).slice(0, 35),
    keyMessage: cleanMultilineText(item.keyMessage).slice(0, 45),
    evidenceOrExplanation: cleanMultilineText(item.evidenceOrExplanation).slice(0, 45),
    whyItMatters: cleanMultilineText(item.whyItMatters).slice(0, 35),
  }));
}

/** Rewrite and repair need direction, not the complete research plan or citations. */
function compactFullNarrationRewritePlan(narrativePlan: SlideNarrative[]) {
  return narrativePlan.slice(0, 10).map((item) => ({
    slideOrder: item.slideOrder,
    title: cleanMultilineText(item.slideTitle).slice(0, 24),
    keyMessage: cleanMultilineText(item.keyMessage).slice(0, 42),
  }));
}

function compactFullNarrationDiagnostics(diagnostics: FullNarrationSafeDiagnostics, requestedOrders = diagnostics.affectedSlideOrders) {
  const selectedOrders = [...new Set(requestedOrders)].sort((left, right) => left - right);
  return {
    totalWords: diagnostics.totalWords,
    issues: diagnostics.issueCodes,
    affectedSlides: selectedOrders,
    sectionWords: selectedOrders.map((order) => ({ order, words: diagnostics.sectionWordCounts[order - 1] || 0 })),
  };
}

function extractRequestedNarrationSections(draft: string, orders: readonly number[]) {
  const requested = new Set(orders);
  return cleanMultilineText(draft)
    .split(/(?=^\u0421\u043b\u0430\u0439\u0434\s+\d+\s*:)/gim)
    .map((section) => section.trim())
    .filter((section) => {
      const match = /^\u0421\u043b\u0430\u0439\u0434\s+(\d+)\s*:/i.exec(section);
      return Boolean(match && requested.has(Number(match[1])));
    })
    .join("\n\n");
}

function compactFullNarrationSourceSnapshot(sources: Source[]) {
  return sources
    .filter((source) => source.included !== false)
    .slice(0, 4)
    .map((source) => ({ title: cleanMultilineText(source.label).slice(0, 40), evidence: cleanMultilineText(source.excerpt).slice(0, 60) }))
    .filter((source) => source.title || source.evidence);
}

/** A deliberately bounded prompt for one independently accepted Lite section. */
export function buildAitunnelNarrationSectionPrompt(
  project: ProjectInput,
  sources: Source[],
  narrative: SlideNarrative,
) {
  const budget = getRussianStudentSpeechTimingBudget(project);
  const bounds = budget && getFloorAwareSpeechTimingSectionBounds(budget, narrative.slideOrder);
  if (!bounds) throw new Error("aitunnel_section_timing_unavailable");
  const { targetWords, minWords, maxWords } = bounds;
  const anchors = sources
    .filter((source) => source.included !== false)
    // The Lite candidate has a fixed 0.25 ₽ persisted reservation. One short
    // source anchor is sufficient factual grounding for a single section and
    // keeps the real request inside that hard preflight bucket.
    .slice(0, 1)
    .map((source) => `${cleanMultilineText(source.label).slice(0, 40)}: ${cleanMultilineText(source.excerpt).slice(0, 120)}`)
    .filter(Boolean);
  return [
    isGeneralProject(project)
      ? "Write one Russian presentation narration section, not a plan or commentary."
      : "Write one Russian university-student narration section, not a plan or commentary.",
    `Topic: ${cleanMultilineText(project.title).slice(0, 96)}.`,
    `Current slide ${narrative.slideOrder}: ${cleanMultilineText(narrative.slideTitle).slice(0, 80)}.`,
    `Key message: ${cleanMultilineText(narrative.keyMessage).slice(0, 120)}.`,
    `Write ${minWords}-${maxWords} words; target ${targetWords}; 2-7 complete sentences. Check count; do not aim for a boundary; never return under ${minWords} words.`,
    "Return exactly one section in this canonical format: `Слайд N: semantic title` followed by its prose.",
    "Explain the topic itself. Do not mention the next slide, a plan, sources, citations, or this instruction. Do not use filler or a template formula.",
    anchors.length ? `Bounded factual anchors (use only when relevant; do not cite them):\n${anchors.join("\n")}` : "Use only cautious, generally supported factual claims.",
  ].join("\n\n");
}

/** A compact, clean replacement request that never exposes the rejected section. */
export function buildAitunnelNarrationSectionReplacementPrompt(
  project: ProjectInput,
  sources: Source[],
  narrative: SlideNarrative,
  failureCategory: NarrationRewriteFailureCategory,
) {
  const budget = getRussianStudentSpeechTimingBudget(project);
  const bounds = budget && getFloorAwareSpeechTimingSectionBounds(budget, narrative.slideOrder);
  if (!bounds) throw new Error("aitunnel_section_timing_unavailable");
  const { targetWords, minWords, maxWords } = bounds;
  // Flash has a fixed 1.20 ₽ reservation, so bound every runtime-derived
  // field even for byte-heavy Russian input.
  const anchors = sources
    .filter((source) => source.included !== false)
    .slice(0, 1)
    .map((source) => `${cleanMultilineText(source.label).slice(0, 28)}: ${cleanMultilineText(source.excerpt).slice(0, 40)}`)
    .filter(Boolean);
  return [
    isGeneralProject(project)
      ? "Write a fresh Russian presentation narration section, not a patch, diagnosis, or commentary."
      : "Write a fresh Russian university-student narration section, not a patch, diagnosis, or commentary.",
    `Topic: ${cleanMultilineText(project.title).slice(0, 64)}. Slide ${narrative.slideOrder}: ${cleanMultilineText(narrative.slideTitle).slice(0, 48)}.`,
    `Key point: ${cleanMultilineText(narrative.keyMessage).slice(0, 40)}. Write ${minWords}-${maxWords} words; target ${targetWords}; 2-7 sentences. Check count; avoid a boundary; never return under ${minWords} words.`,
    "Return exactly one section in the canonical format: `Слайд N: semantic title` followed by prose. Explain the topic itself; do not mention sources, validation, a rejected draft, a plan, or this instruction.",
    `Safe quality focus: ${AITUNNEL_REWRITE_CATEGORY_GUIDANCE[failureCategory]}`,
    anchors.length ? `Bounded factual anchors (use only when relevant; do not cite them):\n${anchors.join("\n")}` : "Use only cautious, generally supported factual claims.",
  ].join("\n\n");
}

/** One-use global Flash replacement; rejected narration and raw validation details are never inputs. */
export function buildAitunnelNarrationGlobalRewritePrompt(project: ProjectInput, sources: Source[], narrative: SlideNarrative, failureCategory: NarrationRewriteFailureCategory) {
  const budget = getRussianStudentSpeechTimingBudget(project);
  const bounds = budget && getFloorAwareSpeechTimingSectionBounds(budget, narrative.slideOrder);
  if (!bounds) throw new Error("aitunnel_section_timing_unavailable");
  const anchors = sources.filter((source) => source.included !== false).slice(0, 2)
    .map((source) => `${cleanMultilineText(source.label).slice(0, 24)}: ${cleanMultilineText(source.excerpt).slice(0, 32)}`).filter(Boolean);
  return [
    isGeneralProject(project)
      ? "Write one fresh Russian presentation narration section."
      : "Write one fresh Russian university narration section.",
    `Topic: ${cleanMultilineText(project.title).slice(0, 48)}. Slide ${narrative.slideOrder}: ${cleanMultilineText(narrative.slideTitle).slice(0, 36)}.`,
    `Key point: ${cleanMultilineText(narrative.keyMessage).slice(0, 40)}. Write ${bounds.minWords}-${bounds.maxWords} words; target ${bounds.targetWords}; 2-7 sentences. Check count; do not aim for a boundary; never return under ${bounds.minWords} words.`,
    "Return exactly `Слайд N: title` plus prose. Explain the topic; never mention sources, validation, drafts, plans, or instructions.",
    `Safe quality focus: ${AITUNNEL_REWRITE_CATEGORY_GUIDANCE[failureCategory]}`,
    anchors.length ? `Facts if relevant; do not cite:\n${anchors.join("\n")}` : "Use cautious supported facts.",
  ].join("\n\n");
}

export function buildNarrationRepairPrompt(
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  previousText: string,
  error: unknown,
  researchBrief?: ResearchBrief,
  attemptNumber = 2,
) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    buildNarrationPrompt(project, sources, narrativePlan, researchBrief),
    "The previous narration answer failed validation.",
    `This is automatic full regeneration attempt ${attemptNumber} of 4.`,
    `Validation error: ${message}`,
    isGeneralProject(project)
      ? "Rewrite the full narration from scratch as one coherent presentation and fix every listed issue."
      : "Rewrite the full narration from scratch as one coherent university student report and fix every listed issue.",
    "Do not patch short sections with generic endings or transition phrases. Replace weak paragraphs with real topic content.",
    "Never explain how slides, sections, neighboring paragraphs, or next parts connect; write the connected content itself.",
    "Every slide section must contain 3-7 complete sentences and enough substance to be read word for word. Sections must not share the same opening or closing phrase.",
    previousText ? `Previous invalid answer, for diagnosis only:\n${cleanMultilineText(previousText).slice(0, 12000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildFullNarrationDurationRewritePrompt(
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  previousText: string,
  error: unknown,
  researchBrief?: ResearchBrief,
) {
  const timingBudget = getRussianStudentSpeechTimingBudget(project);
  const message = error instanceof Error ? error.message : String(error);
  const sectionGuidance = buildFullNarrationDurationSectionGuidance(project, timingBudget);
  return [
    buildNarrationPrompt(project, sources, narrativePlan, researchBrief),
    "The previous full narration was too short and must be discarded.",
    `Validation error for diagnosis only: ${message}`,
    "Write one completely new, coherent report for every requested slide in order. Do not extend, merge with, or reuse passages from the previous answer.",
    timingBudget
      ? `Keep the whole speech inside the quality-first range of ${timingBudget.minWords}-${timingBudget.maxWords} words; ${timingBudget.targetWords} words is a meaningful target, not a quota to reach with filler.`
      : "Keep the narration substantive and naturally paced.",
    sectionGuidance,
    "Treat this as editorial structure, not a word-padding exercise: every section must develop its argument with an explanation and, where supported, an example, evidence, or consequence. A coherent report is better than repetitive length.",
    "Do not use filler, meta-commentary, planner field labels, artificial connective phrases, old opening or closing formulas, or copied slidePurpose or audienceQuestion text. Do not describe the planning process or patch isolated sections.",
    previousText ? `Previous invalid answer for diagnosis only; never quote or continue it:\n${cleanMultilineText(previousText).slice(0, 12000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type NarrationRewriteFailureCategory =
  | "duration"
  | "spoken_quality"
  | "headers_or_sections"
  | "template_or_repetition"
  | "narration_quality";

const AITUNNEL_REWRITE_CATEGORY_GUIDANCE: Record<NarrationRewriteFailureCategory, string> = {
  duration: "Meet the stated whole-speech and per-section timing range with substantive topic explanation, not filler.",
  spoken_quality: "Use natural spoken Russian and avoid repeated facts, repeated sentences, planning formulas, and semicolon-run phrasing.",
  headers_or_sections: "Return every requested slide section exactly once, in order, with its exact heading and a complete section body.",
  template_or_repetition: "Avoid template language, repeated openings or closings, and generic presentation commentary; use concrete topic-specific wording.",
  narration_quality: "Satisfy every narration quality requirement in the original contract with a coherent, substantive report.",
};

const AITUNNEL_TIMING_REASON_GUIDANCE: Record<AitunnelNarrationTimingReason, string> = {
  whole_speech_below_minimum: "Expand the substantive explanation and evidence across the fixed plan. Distribute useful material across every section; do not add filler.",
  whole_speech_above_maximum: "Shorten repeated claims and secondary detail while preserving the causal line, evidence, and conclusion of the report.",
  section_below_minimum: "Repair the distribution of material: develop underfilled sections with topic-specific explanation while keeping the whole speech inside its range.",
  section_above_maximum: "Repair the distribution of material: condense overloaded sections and move only necessary substance to underfilled sections while keeping the whole speech inside its range.",
  section_sentence_count: "Keep every section within the local sentence limit and use complete, natural spoken Russian sentences.",
};

/**
 * AITUNNEL's second narration call is a context-light, full replacement.
 * Unlike the Yandex rewrite builder above, it deliberately receives neither
 * the rejected narration nor a raw validator error.
 */
export function buildAitunnelFullNarrationRewritePrompt(
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  _researchBrief: ResearchBrief | undefined,
  failureCategory: NarrationRewriteFailureCategory,
  timingReasons: readonly AitunnelNarrationTimingReason[] = [],
) {
  const timingBudget = getRussianStudentSpeechTimingBudget(project);
  const timingGuidance = [...new Set(timingReasons)].map((reason) => AITUNNEL_TIMING_REASON_GUIDANCE[reason]);
  const sectionTimingGuidance = timingReasons.includes("whole_speech_below_minimum") || timingReasons.includes("whole_speech_above_maximum")
    ? buildFullNarrationDurationSectionGuidance(project, timingBudget)
    : "";
  const compactPlan = narrativePlan.map((item) => ({
    slideOrder: item.slideOrder,
    slideTitle: item.slideTitle,
    keyMessage: item.keyMessage,
  }));
  const compactSources = sources.slice(0, 4).map((source) => ({
    sourceId: source.id,
    title: source.label,
    evidence: source.excerpt.replace(/\s+/g, " ").trim().slice(0, 220),
  }));
  return [
    isGeneralProject(project)
      ? "Write a fresh, complete Russian speech for a Lazyum presentation."
      : "Write a fresh, complete Russian speech for a Lazyum university presentation.",
    `Topic and request: ${project.prompt}`,
    `Exact slide count: ${project.slideCount}. Return one section per slide in order, headed \`Слайд N: semantic title\`.`,
    "Each section needs 3-7 complete, natural sentences. Use the plan's key message as content, not as a label. Do not mention slides, sources, planning, or the rejected draft.",
    compactPlan.length ? `Fixed slide plan:\n${JSON.stringify(compactPlan)}` : "",
    compactSources.length ? `Grounding source snapshot; use facts only when supported:\n${JSON.stringify(compactSources)}` : "",
    "A previous draft was rejected. Discard it completely and return a fresh, complete narration for every requested slide.",
    AITUNNEL_REWRITE_CATEGORY_GUIDANCE[failureCategory],
    ...timingGuidance,
    "Do not quote, continue, merge, patch, or reuse any text from the rejected draft. Write the whole report from scratch in slide order.",
    timingBudget
      ? `Keep the whole speech inside the quality-first range of ${timingBudget.minWords}-${timingBudget.maxWords} words; ${timingBudget.targetWords} words is a meaningful target, not a quota to reach with filler.`
      : "Keep the narration substantive and naturally paced.",
    timingBudget
      ? `Use the shared section targets to distribute the speech: about ${timingBudget.titleWordTarget} words for the opening, ${timingBudget.contentWordTarget} for each content section, and ${timingBudget.conclusionWordTarget} for the conclusion.`
      : "",
    sectionTimingGuidance,
    timingReasons.includes("whole_speech_below_minimum")
      ? "Before returning, verify the complete draft meets the minimum whole-speech word count. Do not stop early; develop the fixed plan with supported, topic-specific explanation."
      : "",
    "Every section must develop the topic with an explanation and, where supported, an example, evidence, cause, consequence, or conclusion. Avoid filler, repetition, and planner-field wording.",
  ].filter(Boolean).join("\n\n");
}

/**
 * Compact, immutable input for one half of a Gemini narration. It deliberately
 * contains neither a rejected response nor the full research/source corpus.
 */
export function buildAitunnelBatchedNarrationPrompt(
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  slideOrders: readonly number[],
  sectionBudget: { minWords: number; targetWords: number; maxWords?: number },
) {
  const plan = narrativePlan
    .filter((item) => slideOrders.includes(item.slideOrder))
    .map((item) => ({ slideOrder: item.slideOrder, slideTitle: item.slideTitle, keyMessage: item.keyMessage }));
  const snapshot = sources.slice(0, 4).map((source) => ({
    sourceId: source.id,
    title: source.label,
    evidence: source.excerpt.replace(/\s+/g, " ").trim().slice(0, 220),
  }));
  return [
    isGeneralProject(project)
      ? "Write one self-contained part of a Russian presentation speech for StudyDeck."
      : "Write one self-contained part of a Russian university speech for StudyDeck.",
    `Topic and request: ${project.prompt}`,
    `Return exactly the headed sections for slides ${slideOrders.join(", ")} in this order; each starts with \`Слайд N: semantic title\`.`,
    `This part must contain ${sectionBudget.minWords}${sectionBudget.maxWords === undefined ? "+" : `-${sectionBudget.maxWords}`} words total; target ${sectionBudget.targetWords} substantive words.`,
    "Each section needs 2-7 complete, natural sentences. Explain the topic, not the slide or planning process; do not use filler, citations, source names, JSON, markdown, or transition commentary.",
    plan.length ? `Fixed slide plan:\n${JSON.stringify(plan)}` : "",
    snapshot.length ? `Fixed grounding source snapshot; use facts only when supported:\n${JSON.stringify(snapshot)}` : "",
    "Before returning, verify that every requested heading appears exactly once and that this part meets its word range without template padding.",
  ].filter(Boolean).join("\n\n");
}

/**
 * Gives the sole duration-rewrite path a checkable per-section editorial
 * structure while keeping every number tied to the shared timing preset.
 */
function buildFullNarrationDurationSectionGuidance(
  project: ProjectInput,
  timingBudget: ReturnType<typeof getRussianStudentSpeechTimingBudget>,
) {
  if (!timingBudget) return "Return exactly one headed section for every requested slide, in slide order.";

  const { slideCount, titleWordTarget, contentWordTarget, conclusionWordTarget } = timingBudget;
  if (slideCount === 10) {
    return [
      "Return all ten headers exactly once: `Слайд 1:` through `Слайд 10:`, with exactly one complete section per slide.",
      `For this ten-slide budget, make slide 1 at least ${titleWordTarget + 25} words, slide 10 at least ${conclusionWordTarget + 30} words, and slides 2-9 approximately ${contentWordTarget - 25}-${contentWordTarget + 5} words each. Keep the total inside the stated range.`,
    ].join(" ");
  }

  const middleLow = Math.max(1, contentWordTarget - 25);
  const middleHigh = contentWordTarget + 25;
  return [
    `Return all ${slideCount} headers exactly once: \`Слайд 1:\` through \`Слайд ${slideCount}:\`, with exactly one complete section per slide.`,
    `Derive the distribution from this preset: slide 1 is about ${titleWordTarget} words, slide ${slideCount} is about ${conclusionWordTarget} words, and the middle sections are approximately ${middleLow}-${middleHigh} words each while the whole speech stays inside the stated range.`,
  ].join(" ");
}

export function buildSpokenNarrationRewritePrompt(
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  canonicalNarration: string,
  issueOrders: number[],
  issueReasons: string[],
  researchBrief?: ResearchBrief,
) {
  const sections = cleanMultilineText(canonicalNarration)
    .split(/(?=Слайд\s+\d+\s*:)/iu)
    .filter((section) => issueOrders.some((order) => new RegExp(`^Слайд\\s+${order}\\s*:`, "iu").test(section.trim())))
    .join("\n\n");
  const selectedPlan = narrativePlan.filter((item) => issueOrders.includes(item.slideOrder));
  return [
    "Rewrite only the requested Russian oral-narration sections. Return plain text only, without Markdown or commentary.",
    `Return exactly these sections once each and in this order: ${issueOrders.join(", ")}. Keep their headers exactly as \`Слайд N: existing title\`.`,
    `Project: ${project.title}. Request: ${project.prompt}.`,
    `Defects to correct: ${issueReasons.join("; ")}.`,
    "Keep all supported facts and the section meaning. Do not add facts, dates, figures, citations, URLs, source names, slidePurpose, audienceQuestion, planner instructions, or questions for the audience.",
    "Write natural connected speech that can be read aloud. Do not repeat a complete sentence or fact already present in the supplied sections.",
    `Canonical defective sections to rewrite:\n${sections}`,
    selectedPlan.length ? `Narrative plan for meaning only (never copy its field labels or questions):\n${JSON.stringify(selectedPlan)}` : "",
    researchBrief ? `Allowed research context:\n${JSON.stringify(researchBrief)}` : "",
    sources.length ? `Allowed source context:\n${formatSourceText(sources)}` : "",
  ].filter(Boolean).join("\n\n");
}

export function formatNarrativePlanForPrompt(narrativePlan: SlideNarrative[]) {
  if (!narrativePlan.length) {
    return "";
  }

  return JSON.stringify(narrativePlan, null, 2);
}

export function buildGenerationPrompt(
  project: ProjectInput,
  sources: Source[],
  narrationText = "",
  narrativePlan: SlideNarrative[] = [],
  artifacts: PromptArtifacts = {},
) {
  const fixedNarration = cleanMultilineText(narrationText);
  const planText = formatNarrativePlanForPrompt(narrativePlan);
  const theme = resolvePresentationTheme(project);
  const supportedThemeIds = PREMIUM_PRESENTATION_THEME_IDS.join(", ");
  const researchText = artifacts.researchBrief ? JSON.stringify(artifacts.researchBrief, null, 2) : "";
  const storyText = artifacts.deckStory ? JSON.stringify(artifacts.deckStory, null, 2) : "";
  const designText = artifacts.designBrief ? JSON.stringify(artifacts.designBrief, null, 2) : "";
  const blueprintText = artifacts.slideBlueprints?.length ? JSON.stringify(artifacts.slideBlueprints, null, 2) : "";
  const textPlanText = artifacts.slideTextPlans?.length ? JSON.stringify(artifacts.slideTextPlans, null, 2) : "";
  return [
    "Create a complete Lazyum PresentationDocument as JSON.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Mode: ${project.mode}`,
    creationBriefLines(project),
    "All slide-facing text must be in Russian.",
    researchText ? `Use this researchBrief as factual guardrails. Do not invent facts outside it or the source excerpts:\n${researchText}` : "",
    planText ? `Use this fixed narrativePlan and copy it into the final PresentationDocument:\n${planText}` : "",
    storyText ? `Use this deckStory as the deck-level content spine. Do not show it as a separate UI field:\n${storyText}` : "",
    designText ? `Use this designBrief for deck-level visual direction:\n${designText}` : "",
    blueprintText ? `Use these slideBlueprints as per-slide intent. Match slide order, purpose, layout candidate, visual strategy, and text density where possible:\n${blueprintText}` : "",
    textPlanText ? `Use these slideTextPlans as compact projections of the matching accepted speech sections. They are constraints, not an additional story: title, thesis, bullets, blocks, definitions, and visible visual labels may only paraphrase the matching generatedText section. Do not use slideQuestion, narrative-plan fields, sources, or the project request as text donors:\n${textPlanText}` : "",
    fixedNarration
      ? `Use this fixed speech narration as the only source of truth. Copy it exactly into generatedText and do not rewrite its meaning:\n${fixedNarration}`
      : "Use generatedText as the single source of truth for the deck, divided exactly as `Слайд 1: ...` through the requested slide count.",
    "Build title, thesis, bullets, blocks, definition, speakerNotes, speechScript, and visible visual labels only from the matching generatedText section. The matching narrativePlan controls structure only and must never donate visible text.",
    "Each slide has one distinct story job and audience question. Do not reuse a conclusion or chapter label as a second slide's job.",
    "For a date, model, number, biography, legal or scientific claim, use only a matching source excerpt and structured sourceRefs. If support is absent, use a cautious general explanation; never guess an entity category, period, or relation.",
    "Do not merge model families or names: for example BMW 328 is not a BMW M model, and BMW 8 Series is not automatically an M model.",
    "Treat slideTextPlans as a bounded compression layer: keep one supported thesis and zero to three distinct supported bullets. If the speech section has no additional concrete support, omit bullets instead of filling the layout.",
    "Do not generate a separate second story outside generatedText or narrativePlan.",
    "Do not put slidePurpose or transitionToNext on the slide as visible text.",
    "Visual theme rules:",
    `- use this fixed visual theme for the deck: themeId=${theme.themeId || "legacy"}, preset=${theme.preset}, mood=${theme.mood}, font tone=${theme.fonts.tone};`,
    `- supported premium theme IDs are: ${supportedThemeIds}; if presentationTheme.themeId is present, it must be exactly one of these values;`,
    "- do not invent arbitrary theme IDs; keep the fixed themeId from the designBrief or omit themeId for legacy themes;",
    "- do not invent CSS, HTML, font files, or color tokens in the JSON;",
    "- match image descriptions and visual choices to the theme mood: darker and stricter for serious material, lighter and softer for cheerful material;",
    "- vary block presentation from slide to slide through layout and visual.type; do not make every content slide feel like the same card/list template.",
    "Voice model:",
    isGeneralProject(project)
      ? "- use the style of a clear, concrete, calm, human presentation that is professional enough to deliver aloud;"
      : "- use the style of a university student academic study report: clear, concrete, calm, human, and professional enough to present aloud;",
    "- give the audience a path through the subject: what it is, why it matters, what changes, where the conflict or key tension is, and what conclusion follows;",
    "- use concrete details from the material: names, products, organizations, events, causes, consequences, comparisons, or examples;",
    "- when a personal or evaluative conclusion fits the scenario, write it plainly, for example 'Для меня эта история - предупреждение', but only if it suits the topic;",
    "- vary sentence length. Do not make every paragraph the same rhythm.",
    "Required deck structure:",
    "- slide 1 must have slideKind title;",
    "- the final slide must have slideKind summary and contain one short audience-facing answer to the central question plus 2-3 distinct, topic-specific takeaways in bullets;",
    "- the final summary must synthesize earlier narrativePlan jobs and fixed narration without introducing a new fact, date, number, cause, or recommendation;",
    "- never use a standalone final slide with only «Спасибо за внимание», «Вопросы?» or «Мы рассмотрели…»; a small thank-you/questions caption is allowed only after a real conclusion;",
    "- include slideKind section divider slides between major chapters when the deck has enough slides;",
    "- all other study slides must have slideKind content.",
    "Required JSON fields: id, title, scenario, level, slideCount, generatedText, sources, outline, narrativePlan, designBrief, speechScript, slides.",
    "Copy the provided designBrief into the final document exactly unless schema repair requires filling a missing slideDirections item.",
    "Each slide must include: id, order, title, slideKind, layout, thesis, bullets, definition, keyConcepts, visual, highlights, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "Layout rules:",
    "- layout must be one of: hero, summary, statement, quote, timeline, process, image-focus, metrics;",
    "- do not use the same content layout more than twice in a row;",
    "- choose the layout from the slide's idea, not from a fixed template;",
    "- use statement for one strong claim with one short callout and no list;",
    "- use quote when a concise quote or author-like formulation is central;",
    "- use timeline only for chronology with 3-5 dated or named periods; each visual.items entry must have a period in label and the event plus its significance in text;",
    "- use process only for 3-5 ordered actions; each visual.items entry must have a short action in label and an explanation or result in text;",
    "- use image-focus for a concrete image and process for a sequence of actions or stages;",
    "- use metrics only for 2-4 explicit numbers, percentages, dates, durations, or measured quantities already supported by the material; never turn list order into a metric;",
    "Content slide rules:",
    "- title: short, ideally 6-8 words or fewer;",
    "- title: semantic and memorable. Avoid generic titles such as 'Контекст', 'Ключевые факты', 'Примеры', 'Выводы', and 'Итоги' unless there is only one such title in the whole deck;",
    "- thesis: one concise sentence about the real subject matter, not a meta sentence about the slide;",
    "- every content slide must contain one clear thesis plus 2-3 short meaningful points; the thesis and each point must be complete and distinct, and each point adds a fact, explanation, example, or consequence rather than restating the thesis;",
    "- title and summary slides may be more compact. A content slide may omit the 2-3 bullets only for a genuine central quote or a structured explanatory diagram; make that semantic reason explicit in the quote or diagram data.",
    "- bullets: use 2-3 short meaningful points on ordinary content slides; every bullet must be a compressed phrase from the matching narration section;",
    "- definition: { term, text } only when an important term needs a simple definition; otherwise null;",
    "- keyConcepts: return an empty array; do not create small keyword chips on slides;",
    "- highlights: return an empty array; do not create small highlighted word badges on slides;",
    "- blocks: keep a backward-compatible fallback using callout, quote, or bullets; mirror the chosen layout instead of always returning bullets.",
    "Slide-facing text style:",
    "- every visible title, thesis, bullet, block, definition, and visual item must be a complete thought; never end visible text with an unfinished phrase such as 'the first thing to note is rich';",
    "- every layout slot is independent: never begin a bullet, block, or visual explanation as the grammatical continuation of another slot;",
    "- give each slide one distinct takeaway that matches its slideBlueprint and narrativePlan job; do not repeat the same central claim on another slide without a new stage, example, cause, or consequence;",
    "- do not repeat a thesis verbatim in a bullet, block, visual item, or definition; each visible point must add new information;",
    "- use the same clear study-report style as the narration, but much shorter;",
    "- visible slide text must be a compressed version of the matching speech section, not a separate template phrase;",
    "- do not write 'Главная идея связана с темой', 'Материал стоит разбирать по смысловым частям', or similar filler;",
    "- never write phrases like 'Сложную часть \"тема\"', 'Перед финалом остаются самые сильные факты', 'Связь между фактами делает тему понятнее', or similar universal placeholders;",
    "- do not repeat the user's request as content. Answer the request instead.",
    "- do not mention nonexistent topics, pictures, diagrams, images, examples, sources, or visual objects unless they are explicitly present in the provided material;",
    "- do not refer to the slide itself with phrases like 'на слайде показано', 'этот слайд помогает', or 'текст на слайде';",
    "- if the source material is thin, write a cautious general explanation instead of inventing facts or visuals.",
    "- never write generic filler such as 'Финальный вывод раскрывается через контекст, причины и последствия', 'Главные факты лучше воспринимаются, когда между ними видна связь', 'Точная формулировка помогает перейти от факта к смыслу', or similar universal placeholder phrases.",
    "- on the summary slide, thesis must be a complete conclusion rather than the project title or a courtesy phrase; every supporting bullet must be a distinct complete point, not a sentence fragment or a repeat of the thesis;",
    "Narration rules:",
    "- speakerNotes must be the matching generatedText section body or a very close 2-7 sentence restatement, guided by the matching narrativePlan item;",
    "- speechScript must contain one matching 2-7 sentence item for every slide and must duplicate or closely restate the matching speakerNotes;",
    "- slide thesis, bullets, definition, blocks, and visual content must be a short outline based on generatedText and narrativePlan, not on a separate story;",
    "- write narration in a concise study-report style: concrete, human, explanatory, and understandable to listeners;",
    "- speakerNotes and speechScript must continue the report from slide to slide; do not make every slide begin or end with the same pattern;",
    "- keep the report connected by meaning, but never write that a slide, section, step, or detail connects to another slide or section;",
    "- write about the topic, event, phenomenon, causes, consequences, and conclusion, not about the presentation structure;",
    "- do not start narration with 'Слайд ...', 'На этом слайде ...', or similar meta phrases;",
    "- do not use phrases about 'текст на слайде', 'опорные пункты', 'основной смысл раскрывается', 'рассказ про', 'главный акцент здесь', 'часть подводит', or 'Примеры. Поэтому';",
    "- do not use phrases like 'Дальше раздел', 'продолжает тему', 'Сначала важно удержать конкретную мысль', 'Следующая деталь добавляет к объяснению новый шаг', 'новый шаг', 'к следующей части', or 'оставляет место для следующей мысли';",
    "- do not use repeated formula starts like 'Это проявляется в том, что', 'Причина такого вывода в том', or 'Последствия заметны там, где';",
    "- avoid the words 'раздел', 'следующий', 'переход', and 'слайд' in narration unless they are part of the real subject matter;",
    "- never use endings like 'Так становится понятнее, почему тема ... важна именно в этой части рассказа', 'Связь с разделом ... помогает слушателю увидеть не только событие, но и его значение', or 'Без этого уточнения дальнейший вывод...';",
    "- do not write generic phrases like 'this slide explains the section'; explain the actual topic of the slide.",
    "Visual field rules:",
    "- visual.type must be one of: process_diagram, comparison_diagram, cause_effect_diagram, before_after_table, pros_cons_table, timeline, mind_map, illustration, schema, image, none;",
    "- every slide, including title, section, and summary slides, must include visual.description as a concrete image search concept;",
    "- set visual.type to image or illustration when a photo or illustration is the main visual anchor; use none only for structured visual type, not as a reason to omit visual.description;",
    "- never fill visual.title, visual.items, or visual.rows with generic placeholder text just to create a visual block;",
    "- use process_diagram for ordered actions or steps;",
    "- use comparison_diagram for comparing concepts;",
    "- use cause_effect_diagram for causes and consequences;",
    "- use before_after_table for changes over time or transformation;",
    "- use pros_cons_table for evaluating options;",
    "- use timeline for historical or chronological topics;",
    "- use mind_map for relationships between concepts;",
    "- use illustration, schema, or image when a concrete image will explain this exact slide better than text;",
    "- visual.items contains concrete steps/nodes; visual.rows with left/right columns is for tables and comparisons.",
    "- comparison/table visuals must include meaningful left and right values for each row;",
    "- process, timeline, mind_map, and schema visuals must include at least two concrete items;",
    "- for useful academic diagrams, visual may include diagram: { kind, source, fallback, title, caption, safety }; use Mermaid only for processes, cause/effect chains, classifications, timelines, and simple flowcharts;",
    "- diagram.kind must be flowchart, sequence, timeline, or mindmap; diagram.source must be valid Mermaid without HTML, script, URLs, event handlers, or unsafe markup; labels should preferably be Russian;",
    "- diagram.fallback must restate the same structure as plain text so web and exports remain readable if Mermaid rendering fails;",
    "- visual.description must describe a concrete, searchable image for the real subject of the matching narration section in Russian or English;",
    "- visual.description and visualPrompt must stay inside the project domain and matching story job; never introduce an unrelated policy, geopolitics, biology, or finance scene into another topic.",
    "- every slide must have a different visual.description concept so later image search can choose different pictures;",
    "- do not put URLs or image provider names into visual.description; describe the desired scene, object, person, place, chart, or illustration only.",
    "Hard limits:",
    "- Do not write long text blocks on slides.",
    "- Do not put markdown headings, source names, citations, sourceRefs, TODOs, or instructions into title, thesis, bullets, blocks, or speaker notes. sourceRefs remain structured metadata only.",
    "- Do not invent precise facts when the material does not support them; give a general explanation instead.",
    "- Keep detailed narration only in speakerNotes and speechScript.",
    `Source material for factual grounding. Keep source labels only in structured sourceRefs, primarily for evidence layouts:\n${formatSourceText(sources)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function legacyBuildGenerationPrompt(project: ProjectInput, sources: Source[]) {
  return [
    "Собери готовую презентацию Lazyum PresentationDocument.",
    `Тема и запрос пользователя: ${project.prompt}`,
    `Название проекта: ${project.title}`,
    `Сценарий: ${project.scenario}`,
    `Уровень аудитории: ${project.level}`,
    `Количество слайдов: ${project.slideCount}`,
    `Режим: ${project.mode}`,
    creationBriefLines(project),
    "Требования к слайдам:",
    "- каждый слайд выглядит как 16:9 учебный кадр: короткий заголовок и один блок текста на 1-2 фразы;",
    "- текст на слайде должен быть кратким сокращением speakerNotes: без маркированных списков, markdown-заголовков, длинных абзацев и метатекста о презентации;",
    "- источники используй только как внутренний материал для фактов; не упоминай слово 'источник' и названия источников в slides, speakerNotes и speechScript;",
    "- speakerNotes и speechScript должны быть подробным связным текстом, который можно читать во время выступления;",
    "- не используй фразы: 'тезис нужно объяснить', 'проверьте тезис', 'добавьте источник', 'ключевой вывод нужно связать', 'основная мысль слайда', 'Сложную часть \"тема\"', 'Перед финалом остаются самые сильные факты'.",
    "Обязательный JSON: id, title, scenario, level, slideCount, outline, speechScript, slides.",
    "Для каждого slide: id, order, title, layout, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "layout: hero, statement или summary. blocks лучше возвращать как один callout; bullets допустимы только если это 1-2 короткие фразы.",
    `Материалы для внутренней фактологии, не показывать пользователю:\n${formatSourceText(sources)}`,
  ].join("\n\n");
}

export function buildYandexPresentationRecoveryPrompt(
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
  narrativePlan: SlideNarrative[],
  artifacts: PromptArtifacts,
  slideOrders: number[],
  chunkNumber: number,
  chunkCount: number,
) {
  const selectedPlan = narrativePlan.filter((item) => slideOrders.includes(item.slideOrder));
  const selectedBlueprints = artifacts.slideBlueprints?.filter((item) => slideOrders.includes(item.slideOrder)) || [];
  const selectedTextPlans = artifacts.slideTextPlans?.filter((item) => slideOrders.includes(item.slideOrder)) || [];
  const narrationSections = cleanMultilineText(narrationText)
    .split(/(?=Слайд\s+\d+\s*:)/iu)
    .filter((section) => slideOrders.some((order) => new RegExp(`^Слайд\\s+${order}\\s*:`, "iu").test(section.trim())))
    .join("\n\n");
  return [
    "Return one JSON object only, with exactly one key: slides.",
    `This is recovery chunk ${chunkNumber} of ${chunkCount}. Return slides only for these exact orders, once each and in this order: ${slideOrders.join(", ")}.`,
    "Do not return Markdown, a JSON fence, document metadata, or any extra slide.",
    "All user-facing text must be Russian. Keep every fact grounded in the provided narration, plan, and sources; do not add dates, figures, citations, URLs, or entities.",
    `Project: ${project.title}. Requested topic: ${project.prompt}.`,
    `Canonical accepted narration for this range (copy its meaning into speakerNotes and speechScript without rewriting it):\n${narrationSections}`,
    `Narrative plan for this range:\n${JSON.stringify(selectedPlan)}`,
    selectedBlueprints.length ? `Slide blueprints for this range:\n${JSON.stringify(selectedBlueprints)}` : "",
    selectedTextPlans.length ? `Slide text plans for this range:\n${JSON.stringify(selectedTextPlans)}` : "",
    artifacts.designBrief ? `Use this design direction without inventing a new theme:\n${JSON.stringify(artifacts.designBrief)}` : "",
    sources.length ? `Grounding excerpts:\n${formatSourceText(sources)}` : "",
    "Each slide must include the normal Lazyum slide fields: id, order, title, slideKind, layout, thesis, bullets, definition, keyConcepts, visual, highlights, blocks, speakerNotes, timingSeconds, sourceRefs.",
    "Use concise visible text and preserve a substantive conclusion when the requested range contains the final slide.",
  ].filter(Boolean).join("\n\n");
}

export function formatSourceText(sources: Source[]) {
  return sources
    .map((source) => {
      const location = source.url ? `\nURL: ${source.url}` : "";
      return `[${source.id}] ${source.label}${location}\n${source.excerpt}`;
    })
    .join("\n\n")
    .slice(0, 18000);
}

export type YandexModelTier = "primary" | "economy" | "narration";

export function getYandexModelConfig(tier: YandexModelTier = "primary") {
  if (tier === "economy") {
    const model = process.env.YANDEX_ECONOMY_MODEL_NAME?.trim() || "yandexgpt-5-lite";
    if (process.env.YANDEX_ECONOMY_MODEL_URI?.trim()) {
      return { model, uri: process.env.YANDEX_ECONOMY_MODEL_URI.trim() };
    }
    if (!process.env.YANDEX_FOLDER_ID?.trim()) {
      throw new Error("YANDEX_FOLDER_ID or YANDEX_ECONOMY_MODEL_URI is required for Yandex generation");
    }
    return { model, uri: `gpt://${process.env.YANDEX_FOLDER_ID}/${model}` };
  }

  if (tier === "narration") {
    const model = process.env.YANDEX_NARRATION_MODEL_NAME?.trim();
    const uri = process.env.YANDEX_NARRATION_MODEL_URI?.trim();
    if (!model && !uri) return getYandexModelConfig("primary");
    if (!model) throw new Error("YANDEX_NARRATION_MODEL_NAME is required when YANDEX_NARRATION_MODEL_URI is set");
    if (!/^[a-z0-9][a-z0-9.-]*$/i.test(model)) throw new Error("YANDEX_NARRATION_MODEL_NAME must be a supported Yandex model identifier");
    if (uri) {
      if (!/^gpt:\/\/[^/\s]+\/[^/\s]+(?:\/(?:latest|rc))?$/i.test(uri)) throw new Error("YANDEX_NARRATION_MODEL_URI must be a valid Yandex GPT model URI");
      return { model, uri };
    }
    if (!process.env.YANDEX_FOLDER_ID?.trim()) throw new Error("YANDEX_FOLDER_ID or YANDEX_NARRATION_MODEL_URI is required for Yandex narration");
    return { model, uri: `gpt://${process.env.YANDEX_FOLDER_ID}/${model}` };
  }

  const model = process.env.YANDEX_MODEL_NAME?.trim() || "yandexgpt";
  if (process.env.YANDEX_MODEL_URI?.trim()) {
    return { model, uri: process.env.YANDEX_MODEL_URI.trim() };
  }

  if (!process.env.YANDEX_FOLDER_ID?.trim()) {
    throw new Error("YANDEX_FOLDER_ID or YANDEX_MODEL_URI is required for Yandex generation");
  }

  return { model, uri: `gpt://${process.env.YANDEX_FOLDER_ID}/${model}/latest` };
}

export function getYandexModelUri(tier: YandexModelTier = "primary") {
  return getYandexModelConfig(tier).uri;
}
