import crypto from "node:crypto";
import OpenAI from "openai";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { captureGenerationError, errorLogFields, logger } from "../../../observability.js";
import { normalizeOpenAIUsage, recordAiUsage } from "../../../usage-ledger.js";
import {
  type DesignBrief,
  type DeckStory,
  type GenerationPipelineArtifacts,
  type Highlight,
  type KeyConcept,
  type PresentationDocument,
  type QualityCritique,
  type QualityIssue,
  type ResearchBrief,
  type Slide,
  type SlideBlock,
  type SlideBlueprint,
  type SlideDefinition,
  type SlideKind,
  type SlideLayout,
  type SlideNarrative,
  type SlideTextPlan,
  type SlideVisual,
  type MermaidDiagramSpec,
  type Source,
  PREMIUM_PRESENTATION_THEMES,
  PREMIUM_PRESENTATION_THEME_IDS,
  SLIDE_LAYOUT_DEFINITIONS,
  deckStorySchema,
  designBriefSchema,
  generationPipelineArtifactsSchema,
  hasMeasurableValue,
  presentationSchema,
  qualityCritiqueSchema,
  researchBriefSchema,
  resolvePresentationTheme,
  mermaidDiagramSpecSchema,
  slideBlueprintSchema,
  slideNarrativeSchema,
  slideTextPlanSchema,
} from "@studydeck/shared";
import {
  improvePresentationQuality,
  type QualityRepairResponse,
} from "../../presentation-quality.js";

type ProjectInput = {
  id: string;
  title: string;
  prompt: string;
  scenario: string;
  level: string;
  mode: string;
  slideCount: number;
};

type AiGenerationMode = "openai" | "yandex";
type FallbackGenerationMode = "demo" | "demo-fallback";
type EnvLike = Record<string, string | undefined>;

type NarrationSection = {
  order: number;
  title: string;
  text: string;
};

type SlideTextIssue = {
  slideOrder: number;
  fields: string[];
  reasons: string[];
};

type SlideTextRepair = {
  slideOrder: number;
  title?: unknown;
  thesis?: unknown;
  bullets?: unknown;
  blocks?: unknown;
  definition?: unknown;
  visual?: unknown;
};

type SlideTextRepairResponse = {
  slides?: SlideTextRepair[];
};

type QualityModelCallbacks = {
  critique?: (presentation: PresentationDocument, deterministic: QualityCritique) => Promise<unknown>;
  repair?: (presentation: PresentationDocument, issues: QualityIssue[], attempt: number) => Promise<unknown>;
};

type GenerateStructuredOptions<T> = {
  provider: AiGenerationMode;
  system: string;
  prompt: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  schemaName: string;
  parse?: (value: unknown) => T;
  openAIClient?: OpenAI;
  openAIGenerateText?: typeof generateText;
  yandexApiKey?: string;
  jsonSchema?: Record<string, unknown>;
  strict?: boolean;
  maxAttempts?: number;
  temperature?: number;
};

type GenerateAndValidateOptions<T> = {
  call: (attempt: number, repairPrompt?: string) => Promise<unknown>;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  schemaName: string;
  provider?: AiGenerationMode;
  parse?: (value: unknown) => T;
  repair?: (error: unknown, previousValue: unknown, attempt: number) => string;
  maxAttempts?: number;
};

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

type YandexTextOptions = {
  jsonObject?: boolean;
  jsonSchema?: unknown;
  temperature?: number;
  maxTokens?: number;
};

type PromptArtifacts = Partial<Pick<GenerationPipelineArtifacts, "researchBrief" | "deckStory" | "designBrief" | "slideBlueprints" | "slideTextPlans">>;

import type { YandexCompletionResponse } from "../constants.js";
import { STUDENT_CREATION_BRIEF_LINES, NARRATION_SYSTEM_PROMPT, SYSTEM_PROMPT, QUALITY_CRITIC_SYSTEM_PROMPT, QUALITY_REPAIR_SYSTEM_PROMPT, GENERIC_NARRATION_PHRASES, GENERIC_SCREEN_TEXT_PHRASES, TEMPLATE_TEXT_PATTERNS, GENERIC_TITLES, STOP_WORDS, REMOVED_SLIDE_LAYOUTS, SLIDE_LAYOUTS, CONTENT_LAYOUT_CYCLE } from "../constants.js";
import { cleanMultilineText } from "../utilities.js";

export function buildNarrativePlanPrompt(project: ProjectInput, sources: Source[], _researchBrief?: ResearchBrief) {
  return [
    "Верни JSON-массив narrativePlan для StudyDeck презентации.",
    `Тема и запрос пользователя: ${project.prompt}`,
    `Название проекта: ${project.title}`,
    `Сценарий: ${project.scenario}`,
    `Уровень аудитории: ${project.level}`,
    `Ровно слайдов: ${project.slideCount}`,
    `Режим: ${project.mode}`,
    STUDENT_CREATION_BRIEF_LINES,
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
    "Create a StudyDeck DesignBrief JSON. You are choosing art direction, not drawing the slides.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Allowed themeId values: ${themeIds}.`,
    STUDENT_CREATION_BRIEF_LINES,
    "Choose one stable themeId. Do not invent custom theme IDs.",
    "Use studydeckEditorial for every deck. The palette is a stable StudyDeck identity; topic variety comes from imagery and composition, not random colors.",
    "Return exactly one slideDirections item for every slide order.",
    "Do not output raw CSS, HTML, coordinates, pixel sizes, or layout code.",
    "Choose visualRole as a scene role: hero, problem, context, explain, compare, sequence, evidence, quote, visual_statement, or summary.",
    "Choose layoutIntent as an art-direction intent: split_image_text, statement, cards, timeline, diagram, comparison, evidence_board, quote_spread, or summary.",
    "Build Gamma-like visual rhythm while preserving university clarity: strong cover, short text-led moments, image-led scenes only when grounded, diagrams for explanation, evidence support, and a strong final takeaway.",
    "Visible slide text should alternate between one strong phrase, 3-4 short sentence-like fragments, and diagram/photo labels. Full explanation belongs in narration and speaker notes.",
    "Do not repeat the same layoutIntent three times in a row. Do not make every slide a card grid.",
    "Choose sceneTextMode for every slide: hero_phrase, talk_sentences, visual_labels, or takeaway.",
    "Use hero_phrase for the cover, title-like claims, quote spreads, and transition moments; use talk_sentences for 3-4 short spoken beats; use visual_labels for diagrams/photos; use takeaway for the final slide.",
    "Choose imageStrategy independently for every slide: real_photo, diagram, or none. Keep generated_illustration schema-compatible if seen, but do not select it in this version.",
    "Use real_photo only for a concrete, searchable person, place, object, company, event, artwork, historical scene, laboratory object, product, or environment that makes the idea more memorable.",
    "Use diagram for processes, comparisons, causes and effects, concept maps, timelines, structures, and systems. Diagram slides must be understandable from deterministic shapes and labels without an external image.",
    "Use none for strong theses, abstract claims, thinly sourced topics, reflective moments, and the final takeaway. Never request a random stock image merely to fill space.",
    "Across grounded decks, use a real_photo on roughly 50-70 percent of non-summary slides and a diagram on most remaining explanatory slides.",
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
  return [
    "Write the complete speech text for a StudyDeck presentation.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Mode: ${project.mode}`,
    STUDENT_CREATION_BRIEF_LINES,
    researchBrief ? `Research brief to use for factual grounding:\n${JSON.stringify(researchBrief, null, 2)}` : "",
    planText ? `Narrative plan to follow exactly:\n${planText}` : "",
    "Output format:",
    "- plain text only;",
    "- exactly one section per slide;",
    "- every section starts with `Слайд N: semantic title`;",
    "- N must run from 1 through the exact slide count without gaps;",
    "- after each title line, write 3-7 complete sentences; vary the count naturally instead of padding every slide to the same size;",
    "- target roughly 45-90 spoken words per slide and about 35-55 seconds of reading time per slide;",
    "- do not use bullet lists, markdown, JSON, citations, source names, or comments.",
    "University speech rules:",
    "- write as a prepared university student: natural, confident, easy to read aloud, and professional without bureaucratic wording;",
    "- compose the whole answer as one continuous speech before splitting it into slide sections;",
    "- the student must be able to read the result word for word, with no rewriting or improvised connective phrases;",
    "- the first section naturally establishes the subject and central question; do not begin with `Сегодня я расскажу`, `На этом слайде`, or another presentation cliché;",
    "- middle sections must grow out of the previous idea through facts, causes, contrasts, consequences, or chronology, without announcing a transition;",
    "- the last section must answer the central question with a real conclusion or judgment instead of repeating the slide list;",
    "- every section must explain the real topic, not the slide object;",
    "- every section must include at least one concrete detail, example, reason, consequence, contrast, or definition;",
    "- keep the full explanation in narration; visible slide text will be compressed later;",
    "- make neighboring openings and endings different in wording and rhythm;",
    "- make the final section a human university-level conclusion tied to the topic.",
    "Narrative plan rules:",
    "- every generatedText section must correspond to one narrativePlan element;",
    "- the section title must match or closely follow slideTitle;",
    "- each section must answer audienceQuestion;",
    "- each section must develop keyMessage;",
    "- follow transitionToNext by meaning, but never write mechanical phrases like `перейдем к следующему слайду`.",
    "Style model:",
    "- close to a university student report: direct, academic without stiffness, and easy to read aloud;",
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
    `Source material for internal factual grounding only; do not show source labels to the user:\n${formatSourceText(sources)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildNarrationRepairPrompt(
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  previousText: string,
  error: unknown,
  researchBrief?: ResearchBrief,
) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    buildNarrationPrompt(project, sources, narrativePlan, researchBrief),
    "The previous narration answer failed validation.",
    `Validation error: ${message}`,
    "Rewrite the full narration from scratch as one coherent university student report and fix every listed issue.",
    "Do not patch short sections with generic endings or transition phrases. Replace weak paragraphs with real topic content.",
    "Never explain how slides, sections, neighboring paragraphs, or next parts connect; write the connected content itself.",
    "Every slide section must contain 3-7 complete sentences and enough substance to be read word for word. Sections must not share the same opening or closing phrase.",
    previousText ? `Previous invalid answer, for diagnosis only:\n${cleanMultilineText(previousText).slice(0, 12000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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
    "Create a complete StudyDeck PresentationDocument as JSON.",
    `User topic and request: ${project.prompt}`,
    `Project title: ${project.title}`,
    `Scenario: ${project.scenario}`,
    `Audience level: ${project.level}`,
    `Exact slide count: ${project.slideCount}`,
    `Mode: ${project.mode}`,
    STUDENT_CREATION_BRIEF_LINES,
    "All slide-facing text must be in Russian.",
    researchText ? `Use this researchBrief as factual guardrails. Do not invent facts outside it or the source excerpts:\n${researchText}` : "",
    planText ? `Use this fixed narrativePlan and copy it into the final PresentationDocument:\n${planText}` : "",
    storyText ? `Use this deckStory as the deck-level content spine. Do not show it as a separate UI field:\n${storyText}` : "",
    designText ? `Use this designBrief for deck-level visual direction:\n${designText}` : "",
    blueprintText ? `Use these slideBlueprints as per-slide intent. Match slide order, purpose, layout candidate, visual strategy, and text density where possible:\n${blueprintText}` : "",
    textPlanText ? `Use these slideTextPlans as per-slide text structure. Build each slide from slideQuestion, coreClaim, evidenceOrExample, listenerTakeaway, title, thesis, bullets, and speakerNotes:\n${textPlanText}` : "",
    fixedNarration
      ? `Use this fixed speech narration as the only source of truth. Copy it exactly into generatedText and do not rewrite its meaning:\n${fixedNarration}`
      : "Use generatedText as the single source of truth for the deck, divided exactly as `Слайд 1: ...` through the requested slide count.",
    "Build title, thesis, bullets, blocks, visual.description, speakerNotes, and speechScript from the matching generatedText section and the matching narrativePlan item.",
    "Each slide has one distinct story job and audience question. Do not reuse a conclusion or chapter label as a second slide's job.",
    "For a date, model, number, biography, legal or scientific claim, use only a matching source excerpt and structured sourceRefs. If support is absent, use a cautious general explanation; never guess an entity category, period, or relation.",
    "Do not merge model families or names: for example BMW 328 is not a BMW M model, and BMW 8 Series is not automatically an M model.",
    "Treat the slideTextPlans as the compression layer: visible text comes from title, thesis, and bullets; speakerNotes remain the richer 2-7 sentence report text.",
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
    "- use the style of a university student academic study report: clear, concrete, calm, human, and professional enough to present aloud;",
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
    "- every slide must contain one clear thesis plus 2-3 short meaningful points when the layout supports points;",
    "- bullets: 0-3 short meaningful points; use bullets only when the slide is genuinely a list or a summary; every bullet must be a compressed phrase from the matching narration section;",
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
    "Собери готовую презентацию StudyDeck PresentationDocument.",
    `Тема и запрос пользователя: ${project.prompt}`,
    `Название проекта: ${project.title}`,
    `Сценарий: ${project.scenario}`,
    `Уровень аудитории: ${project.level}`,
    `Количество слайдов: ${project.slideCount}`,
    `Режим: ${project.mode}`,
    STUDENT_CREATION_BRIEF_LINES,
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

export function formatSourceText(sources: Source[]) {
  return sources
    .map((source) => {
      const location = source.url ? `\nURL: ${source.url}` : "";
      return `[${source.id}] ${source.label}${location}\n${source.excerpt}`;
    })
    .join("\n\n")
    .slice(0, 18000);
}

export type YandexModelTier = "primary" | "economy";

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
