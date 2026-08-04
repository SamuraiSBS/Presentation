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
  type FactualTopicProfile,
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

type AiGenerationMode = "openai" | "yandex" | "aitunnel";
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
import { getRussianStudentSpeechTimingBudget } from "@studydeck/shared";
import { STUDENT_CREATION_BRIEF_LINES, NARRATION_SYSTEM_PROMPT, SYSTEM_PROMPT, QUALITY_CRITIC_SYSTEM_PROMPT, QUALITY_REPAIR_SYSTEM_PROMPT, GENERIC_NARRATION_PHRASES, GENERIC_SCREEN_TEXT_PHRASES, TEMPLATE_TEXT_PATTERNS, GENERIC_TITLES, STOP_WORDS, REMOVED_SLIDE_LAYOUTS, SLIDE_LAYOUTS, CONTENT_LAYOUT_CYCLE } from "../constants.js";
import { normalizeNarrationText, parseNarrationSections } from "../narration/processing.js";
import { fallbackTitle, sentenceCount, firstSentence, lastSentence, wordCount, normalizeTitleKey, isGenericSlideTitle } from "../normalization/presentation.js";
import { hasGenericOrMetaScreenText, looksLikeSentenceFragment, completeNarrationSentences, isCompleteScreenSentence } from "../quality/orchestration.js";
import { parseJsonText, cleanMultilineText, cleanText, projectTopic, shortenSentence, shortenWords } from "../utilities.js";

export function buildResearchBrief(project: ProjectInput, sources: Source[]): ResearchBrief {
  const facts = sources.slice(0, 4)
    .map((source) => {
      const text = completeSourceSentence((source.excerpt || source.label || project.prompt).slice(0, 320), 260);
      return {
        text,
        sourceId: source.id,
        confidence: source.type === "WEB" || source.type === "PROMPT" ? "medium" as const : "high" as const,
      };
    })
    .filter((fact) => fact.text);
  const topic = projectTopic(project);
  return researchBriefSchema.parse({
    topic,
    angle: `Explain ${topic} as a clear university student study story for ${project.level}.`,
    facts,
    warnings: facts.length ? [] : ["No source excerpts were available; avoid precise unsupported facts."],
    vocabulary: buildResearchVocabulary(project, sources),
  });
}

export function buildResearchVocabulary(project: ProjectInput, sources: Source[]) {
  const text = [project.title, project.prompt, ...sources.slice(0, 4).map((source) => (source.excerpt || source.label).slice(0, 320))].join(" ");
  const terms = [...new Set(text.match(/[\p{L}\p{N}][\p{L}\p{N}-]{5,}/gu) || [])]
    .filter((term) => !/^\d+$/.test(term))
    .slice(0, 6);
  return terms.map((term) => ({
    term,
    explanation: `Key term for the topic: ${term}.`,
  }));
}

/** A bounded profile for one generated deck, never a global fact database. */
export function buildFactualTopicProfile(
  project: ProjectInput,
  sources: Source[],
  acceptedNarration = "",
  narrativePlan: SlideNarrative[] = [],
): FactualTopicProfile {
  const sourceText = sources.map((source) => `${source.label} ${source.excerpt || ""}`).join(" ");
  const scope = [project.title, project.prompt, acceptedNarration, ...narrativePlan.flatMap((item) => [item.slideTitle, item.keyMessage]), sourceText].join(" ");
  const terms = [...new Set((scope.match(/[\p{L}\p{N}][\p{L}\p{N}-]{3,}/gu) || [])
    .map((term) => term.trim())
    .filter((term) => !/^\d+$/.test(term) && !STOP_WORDS.has(term.toLowerCase())))]
    .slice(0, 36);
  const allowedEntities = [...new Set(scope.match(/(?:BMW\s+(?:M|\d{1,3}|[A-Z][\p{L}\p{N}-]+)|[A-ZА-ЯЁ][\p{L}\p{N}-]+(?:\s+[A-ZА-ЯЁ][\p{L}\p{N}-]+){0,2})/gu) || [])]
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 24);
  const years = scope.match(/\b(?:18|19|20)\d{2}\b/g) || [];
  const timeRange = years.length ? `${years[0]}${years.length > 1 ? `–${years.at(-1)}` : ""}` : "";
  const domainAnchors = [...new Set([...terms.slice(0, 12), ...allowedEntities.slice(0, 8)])].slice(0, 20);
  return { topicTerms: terms, allowedEntities, timeRange, domainAnchors };
}

export function buildDesignBrief(project: ProjectInput, researchBrief: ResearchBrief, narrativePlan: SlideNarrative[]): DesignBrief {
  const theme = PREMIUM_PRESENTATION_THEMES.studydeckEditorial;
  const themeId = theme.themeId || "studydeckEditorial";
  const hasGroundedVisualContext = researchBrief.facts.some((fact) => fact.confidence !== "low");
  let directions: DesignBrief["slideDirections"] = Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, order);
    const sceneText = `${plan.slideTitle} ${plan.keyMessage} ${project.title}`;
    const visualRole: DesignBrief["slideDirections"][number]["visualRole"] =
      order === 1 ? "hero" :
      order === project.slideCount ? "summary" :
      /сравн|compare|versus|\bvs\b/i.test(sceneText) ? "compare" :
      /этап|шаг|chron|хрон|дата|год|period|timeline/i.test(sceneText) ? "sequence" :
      /доказ|fact|source|источник|пример|evidence/i.test(sceneText) ? "evidence" :
      /проблем|риск|challenge|problem|barrier/i.test(sceneText) ? "problem" :
      /цитат|quote/i.test(sceneText) ? "quote" :
      order === 2 ? "context" :
      order % 5 === 0 ? "visual_statement" :
      researchBrief.facts.length > 0 && order % 4 === 0 ? "evidence" :
      "explain";
    const visualNeed = classifyVisualNeed(project, plan, visualRole, hasGroundedVisualContext);
    const layoutIntent = visualNeed.layoutIntent;
    const imageStrategy = visualNeed.imageStrategy;
    const sceneTextMode = buildSceneTextMode(order, project.slideCount, visualRole, layoutIntent, imageStrategy);
    return {
      slideOrder: order,
      visualRole,
      layoutIntent,
      imageStrategy,
      visualPurpose: visualPurposeFor(layoutIntent, imageStrategy),
      visualRationale: visualRationaleFor(plan, layoutIntent, imageStrategy),
      sceneTextMode,
      visualPrompt: buildDeterministicVisualPrompt(project, plan, imageStrategy, layoutIntent),
    };
  });
  for (let index = 2; index < directions.length; index += 1) {
    const current = directions[index];
    const previous = directions[index - 1];
    const beforePrevious = directions[index - 2];
    if (current.layoutIntent !== previous.layoutIntent || current.layoutIntent !== beforePrevious.layoutIntent) continue;

    const replacement = (["statement", "diagram", "cards"] as const).find((intent) => intent !== previous.layoutIntent) || "statement";
    directions[index] = {
      ...current,
      layoutIntent: replacement,
      imageStrategy: replacement === "diagram" ? "diagram" : "none",
      sceneTextMode: buildSceneTextMode(
        current.slideOrder,
        project.slideCount,
        current.visualRole,
        replacement,
        replacement === "diagram" ? "diagram" : "none",
      ),
      visualPrompt: buildDeterministicVisualPrompt(
        project,
        narrativePlan[index] || buildFallbackNarrativeItem(project, current.slideOrder),
        replacement === "diagram" ? "diagram" : "none",
        replacement,
      ),
    };
  }
  directions = balanceDeterministicVisualDirections(directions, project, narrativePlan, hasGroundedVisualContext);
  return designBriefSchema.parse({
    themePreset: theme.preset,
    themeId,
    mood: theme.mood,
    audienceFit: `Designed for university_student academic work: ${project.level} in a ${project.scenario} scenario.`,
    visualMetaphor: `${researchBrief.topic}: ${researchBrief.angle}`,
    colorIntent: `Use ${themeId} colors with strong readability and one clear accent.`,
    typographyIntent: `Use ${theme.fonts.tone} typography: ${theme.fonts.heading} for headings and ${theme.fonts.body} for body text.`,
    rhythm: {
      titleStyle: theme.fonts.tone === "bookish" ? "editorial" : theme.fonts.tone === "strict" ? "academic" : "bold",
      density: "low",
      imageFrequency: "rare",
      sectionBreaks: project.slideCount >= 6,
    },
    visualDirection: `${researchBrief.topic}: ${researchBrief.angle}`,
    layoutPrinciples: [
      "Use a title opener, varied content layouts, and a clear summary slide.",
      "Keep visible text short and reserve full explanation for speaker notes.",
      "For new decks, use only traceable real documentary photos, evidence-driven diagrams, or text-led layouts; never request an AI illustration.",
      "Keep every photo in its own 35-60 percent grid column and never put text over an image.",
      `Support ${Math.max(1, narrativePlan.length)} planned story beats with distinct visual rhythm.`,
    ],
    imageStrategy: "New-generation visual policy: real_photo, diagram, or none only. Use one real photo per five slides (hard maximum two) and only for a concrete source-grounded person, place, object, event, model, or period; turn abstract claims into a diagram, comparison, timeline, or statement.",
    slideDirections: directions,
  });
}

function visualPurposeFor(
  layoutIntent: DesignBrief["slideDirections"][number]["layoutIntent"],
  imageStrategy: DesignBrief["slideDirections"][number]["imageStrategy"],
): DesignBrief["slideDirections"][number]["visualPurpose"] {
  if (imageStrategy === "real_photo") return "photo";
  if (layoutIntent === "timeline") return "timeline";
  if (layoutIntent === "comparison") return "comparison";
  if (layoutIntent === "metric") return "metric";
  return imageStrategy === "diagram" ? "diagram" : "text_only";
}

function visualRationaleFor(
  plan: SlideNarrative,
  layoutIntent: DesignBrief["slideDirections"][number]["layoutIntent"],
  imageStrategy: DesignBrief["slideDirections"][number]["imageStrategy"],
) {
  const subject = shortenWords(cleanText(plan.keyMessage || plan.slideTitle || plan.slidePurpose), 18);
  if (imageStrategy === "real_photo") return `A concrete documentary subject makes ${subject} observable.`;
  if (layoutIntent === "comparison") return `Comparable evidence clarifies the contrast in ${subject}.`;
  if (layoutIntent === "timeline") return `Ordered stages make the development of ${subject} legible.`;
  if (layoutIntent === "metric") return `A measured value makes the scale of ${subject} legible.`;
  if (imageStrategy === "diagram") return `A semantic diagram explains the relationships in ${subject}.`;
  return `Text-led emphasis is safer than inventing an unsupported visual for ${subject}.`;
}

/**
 * Translate the narrative job into the existing direction fields.  Keeping
 * this private avoids another public enum while making the visual choice
 * semantic rather than an alternating template pattern.
 */
function classifyVisualNeed(
  project: ProjectInput,
  plan: SlideNarrative,
  visualRole: DesignBrief["slideDirections"][number]["visualRole"],
  hasGroundedVisualContext: boolean,
) {
  const scene = `${plan.slideTitle} ${plan.keyMessage} ${plan.slidePurpose}`;
  const concreteScene = isConcreteVisualScene(`${scene} ${project.title}`) || hasSpecificVisualAnchor(`${scene} ${project.title}`);
  const timeline = /\b(?:timeline|history|historical|chronolog\w*|era|generation|first generation|19\d{2}|20\d{2})\b|(?:истори|хронолог|эпох|поколени|\b\d{4}\b)/iu.test(scene);
  const comparison = /\b(?:compare|comparison|versus|\bvs\b|difference)\b|(?:сравнен|различи|противопостав)/iu.test(scene);
  const process = isExplanationHeavyScene(scene) || /\b(?:cause|effect|mechanism|system|workflow|structure)\b|(?:причин|следств|механизм|систем|процесс)/iu.test(scene);

  if (visualRole === "summary") return { layoutIntent: "summary" as const, imageStrategy: "none" as const };
  if (comparison || visualRole === "compare") return { layoutIntent: "comparison" as const, imageStrategy: "diagram" as const };
  if (timeline || visualRole === "sequence") return { layoutIntent: "timeline" as const, imageStrategy: "diagram" as const };
  if (process) return { layoutIntent: "diagram" as const, imageStrategy: "diagram" as const };
  if (visualRole === "evidence") return { layoutIntent: "evidence_board" as const, imageStrategy: "diagram" as const };
  if (visualRole === "quote" || visualRole === "visual_statement" || visualRole === "problem") {
    return { layoutIntent: visualRole === "quote" ? "quote_spread" as const : "statement" as const, imageStrategy: "none" as const };
  }
  if (concreteScene && hasGroundedVisualContext) return { layoutIntent: "split_image_text" as const, imageStrategy: "real_photo" as const };
  return { layoutIntent: visualRole === "hero" ? "statement" as const : "cards" as const, imageStrategy: "none" as const };
}

function hasSpecificVisualAnchor(value: string) {
  return /\b(?:[A-Z][A-Za-z]{2,}|[A-Z]{2,}|\d{3,4})\b/.test(cleanText(value));
}

export function logStructuredGenerationValidationFailure(provider: AiGenerationMode | undefined, schemaName: string, attempt: number, error: unknown) {
  logger.warn({
    stage: "ai_provider_call",
    provider,
    schemaName,
    retry: attempt,
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: formatStructuredGenerationError(error),
  }, "ai structured generation validation failed");
}

export function formatStructuredGenerationError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

const CONCRETE_VISUAL_SCENE_PATTERN = /(?:\b(?:person|people|students?|campus|universit\w*|classroom|laboratory|museum|city|country|company|factory|building|device|robot|car|vehicle|book|painting|sculpture|artifact|product|machine|computer|phone|conference|protest|battle|war|expedition|landscape|environment)\b|(?:человек|люди|студент|университет|кампус|аудитори|лаборатори|музей|город|стран|компани|завод|здани|устройств|робот|автомобил|машин|книг|картин|скульптур|артефакт|продукт|компьютер|телефон|конференц|протест|битв|войн|экспедиц|ландшафт|окружающ))/iu;
const ABSTRACT_VISUAL_SCENE_PATTERN = /(?:\b(?:principle|idea|ethic|meaning|value|theory|concept|conclusion|takeaway)\b|(?:принцип|иде[яи]|этик|смысл|ценност|теори|концепц|вывод|итог))/iu;
const EXPLANATION_VISUAL_SCENE_PATTERN = /(?:\b(?:process|workflow|system|structure|cause|effect|cycle|stage|step|mechanism|relationship|hierarchy|timeline|compare|versus)\b|(?:процесс|систем|структур|причин|следств|цикл|этап|шаг|механизм|связ|иерарх|хронолог|сравнен))/iu;

export function isConcreteVisualScene(value: string) {
  const text = cleanText(value);
  return CONCRETE_VISUAL_SCENE_PATTERN.test(text) && !ABSTRACT_VISUAL_SCENE_PATTERN.test(text);
}

export function isExplanationHeavyScene(value: string) {
  return EXPLANATION_VISUAL_SCENE_PATTERN.test(cleanText(value));
}

export function buildDeterministicVisualPrompt(
  project: ProjectInput,
  plan: SlideNarrative,
  imageStrategy: DesignBrief["slideDirections"][number]["imageStrategy"],
  layoutIntent: DesignBrief["slideDirections"][number]["layoutIntent"],
) {
  const subject = shortenWords(cleanText(plan.keyMessage || plan.slideTitle || project.title), 12);
  if (imageStrategy === "real_photo") {
    return `Documentary scene of ${subject}; real people, place, object, or event from ${cleanText(project.title)}`;
  }
  if (imageStrategy === "diagram") {
    const diagramType = layoutIntent === "timeline" ? "Timeline" : layoutIntent === "comparison" ? "Comparison" : "Concept";
    return `${diagramType} diagram showing ${subject}`;
  }
  return `Text-led emphasis on ${subject}`;
}

export function completeVisualPrompt(
  project: ProjectInput,
  plan: SlideNarrative,
  imageStrategy: DesignBrief["slideDirections"][number]["imageStrategy"],
  layoutIntent: DesignBrief["slideDirections"][number]["layoutIntent"],
  value: string,
) {
  const prompt = cleanText(value);
  if (prompt && !isWeakVisualPrompt(prompt)) return prompt;
  return buildDeterministicVisualPrompt(project, plan, imageStrategy, layoutIntent);
}

export function isWeakVisualPrompt(value: string) {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized || normalized === "..." || normalized.length < 16) return true;
  return /\b(?:educational|presentation|generic|abstract|stock|high quality|realistic|editorial|opening)\s+(?:image|photo|visual|picture)\b/i.test(normalized)
    || /\b(?:image|photo|visual|picture)\s+for\b/i.test(normalized)
    || /(?:РѕР±СЂР°Р·РѕРІР°С‚РµР»СЊРЅ|РїСЂРµР·РµРЅС‚Р°С†|СЃР»Р°Р№Рґ|РєР°С‡РµСЃС‚РІРµРЅРЅ|СЂРµР°Р»РёСЃС‚РёС‡РЅ)\s+(?:РёР·РѕР±СЂР°Р¶РµРЅ|С„РѕС‚Рѕ|РєР°СЂС‚РёРЅ|РІРёР·СѓР°Р»)/iu.test(normalized);
}

export function buildSceneTextMode(
  order: number,
  slideCount: number,
  visualRole: DesignBrief["slideDirections"][number]["visualRole"],
  layoutIntent: DesignBrief["slideDirections"][number]["layoutIntent"],
  imageStrategy: DesignBrief["slideDirections"][number]["imageStrategy"],
): DesignBrief["slideDirections"][number]["sceneTextMode"] {
  if (order === 1 || visualRole === "hero" || layoutIntent === "quote_spread") return "hero_phrase";
  if (order === slideCount || visualRole === "summary" || layoutIntent === "summary") return "takeaway";
  if (
    imageStrategy === "real_photo" ||
    imageStrategy === "diagram" ||
    layoutIntent === "diagram" ||
    layoutIntent === "timeline" ||
    layoutIntent === "comparison" ||
    layoutIntent === "evidence_board"
  ) return "visual_labels";
  return order % 4 === 0 ? "hero_phrase" : "talk_sentences";
}

export function balanceDeterministicVisualDirections(
  directions: DesignBrief["slideDirections"],
  project: ProjectInput,
  narrativePlan: SlideNarrative[],
  hasGroundedVisualContext: boolean,
) {
  if (!hasGroundedVisualContext || directions.length < 3 || !hasConcreteVisualTopic(project, narrativePlan)) {
    return applyEconomicPhotoAllocation(diversifySceneTextModes(directions, project, narrativePlan), project, narrativePlan);
  }

  const contentIndexes = directions
    .map((direction, index) => ({ direction, index }))
    .filter(({ direction }) => direction.slideOrder !== 1 && direction.visualRole !== "summary");
  if (!contentIndexes.length) return applyEconomicPhotoAllocation(diversifySceneTextModes(directions, project, narrativePlan), project, narrativePlan);

  const minimumVisuals = Math.ceil(contentIndexes.length * 0.6);
  const maximumVisuals = Math.max(minimumVisuals, Math.floor(contentIndexes.length * 0.75));
  const isVisual = (direction: DesignBrief["slideDirections"][number]) => direction.imageStrategy === "real_photo" || direction.imageStrategy === "diagram";
  let visualCount = contentIndexes.filter(({ direction }) => isVisual(direction)).length;
  const balanced = [...directions];

  for (const { index } of contentIndexes) {
    if (visualCount >= minimumVisuals) break;
    const direction = balanced[index];
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, direction.slideOrder);
    if (isVisual(direction) || direction.visualRole === "quote") continue;
    const need = classifyVisualNeed(project, plan, direction.visualRole, true);
    const strategy = need.imageStrategy === "none" ? "diagram" as const : need.imageStrategy;
    const layout = need.imageStrategy === "none" ? "diagram" as const : need.layoutIntent;
    balanced[index] = { ...direction, layoutIntent: layout, imageStrategy: strategy, sceneTextMode: "visual_labels", visualPrompt: buildDeterministicVisualPrompt(project, plan, strategy, layout) };
    visualCount += 1;
  }

  for (let index = contentIndexes.length - 1; index >= 0 && visualCount > maximumVisuals; index -= 1) {
    const directionIndex = contentIndexes[index].index;
    const direction = balanced[directionIndex];
    if (!isVisual(direction) || direction.visualRole === "evidence" || direction.visualRole === "sequence" || direction.visualRole === "compare") continue;
    const plan = narrativePlan[directionIndex] || buildFallbackNarrativeItem(project, direction.slideOrder);
    balanced[directionIndex] = {
      ...direction,
      layoutIntent: "cards",
      imageStrategy: "none",
      sceneTextMode: "talk_sentences",
      visualPrompt: buildDeterministicVisualPrompt(project, plan, "none", "cards"),
    };
    visualCount -= 1;
  }

  if (!balanced.some((direction) => direction.imageStrategy === "diagram")) {
    const diagramIndex = balanced.findIndex((direction) =>
      direction.visualRole !== "hero" &&
      direction.visualRole !== "summary" &&
      direction.imageStrategy !== "real_photo",
    );
    if (diagramIndex >= 0) {
      const direction = balanced[diagramIndex];
      const plan = narrativePlan[diagramIndex] || buildFallbackNarrativeItem(project, direction.slideOrder);
      balanced[diagramIndex] = {
        ...direction,
        layoutIntent: "diagram",
        imageStrategy: "diagram",
        sceneTextMode: "visual_labels",
        visualPrompt: buildDeterministicVisualPrompt(project, plan, "diagram", "diagram"),
      };
    }
  }

  for (let index = 2; index < contentIndexes.length; index += 1) {
    const run = contentIndexes.slice(index - 2, index + 1).map(({ index: directionIndex }) => balanced[directionIndex]);
    if (run.every((direction) => direction.imageStrategy === "none")) {
      const directionIndex = contentIndexes[index].index;
      const direction = balanced[directionIndex];
      const plan = narrativePlan[directionIndex] || buildFallbackNarrativeItem(project, direction.slideOrder);
      balanced[directionIndex] = { ...direction, layoutIntent: "diagram", imageStrategy: "diagram", sceneTextMode: "visual_labels", visualPrompt: buildDeterministicVisualPrompt(project, plan, "diagram", "diagram") };
    }
  }

  return applyEconomicPhotoAllocation(diversifySceneTextModes(balanced, project, narrativePlan), project, narrativePlan);
}

/** Economic standard runs reserve at most two concrete web-photo directions. */
export function applyEconomicPhotoAllocation(
  directions: DesignBrief["slideDirections"],
  project: ProjectInput,
  narrativePlan: SlideNarrative[],
) {
  const photoLimit = Math.min(2, Math.max(0, Math.ceil(project.slideCount / 5)));
  let retained = 0;
  return directions.map((direction, index) => {
    if (direction.imageStrategy !== "real_photo") return direction;
    if (retained < photoLimit) {
      retained += 1;
      return direction;
    }
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, direction.slideOrder);
    const diagram = ["context", "explain", "evidence", "sequence", "compare"].includes(direction.visualRole);
    const imageStrategy = diagram ? "diagram" as const : "none" as const;
    const layoutIntent = diagram ? "diagram" as const : "statement" as const;
    return {
      ...direction,
      imageStrategy,
      layoutIntent,
      sceneTextMode: diagram ? "visual_labels" as const : "talk_sentences" as const,
      visualPurpose: diagram ? "diagram" as const : "text_only" as const,
      visualRationale: diagram ? "The economic photo allocation is exhausted; explain this material locally." : "The economic photo allocation is exhausted; keep this conclusion text-led.",
      visualPrompt: buildDeterministicVisualPrompt(project, plan, imageStrategy, layoutIntent),
    };
  });
}

function hasConcreteVisualTopic(project: ProjectInput, narrativePlan: SlideNarrative[]) {
  return isConcreteVisualScene(`${project.title} ${project.prompt}`)
    || hasSpecificVisualAnchor(`${project.title} ${project.prompt}`)
    || narrativePlan.some((plan) => isConcreteVisualScene(`${plan.slideTitle} ${plan.keyMessage}`) || hasSpecificVisualAnchor(`${plan.slideTitle} ${plan.keyMessage}`));
}

export function diversifySceneTextModes(
  directions: DesignBrief["slideDirections"],
  project: ProjectInput,
  narrativePlan: SlideNarrative[],
) {
  const balanced = [...directions];
  for (let index = 2; index < balanced.length; index += 1) {
    const current = balanced[index];
    const previous = balanced[index - 1];
    const beforePrevious = balanced[index - 2];
    if (current.sceneTextMode !== previous.sceneTextMode || current.sceneTextMode !== beforePrevious.sceneTextMode) continue;
    const replacement = current.visualRole === "summary"
      ? "takeaway"
      : current.sceneTextMode === "visual_labels"
        ? "talk_sentences"
        : current.sceneTextMode === "talk_sentences"
          ? "hero_phrase"
          : "talk_sentences";
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, current.slideOrder);
    const nextLayout = replacement === "takeaway"
      ? "summary"
      : replacement === "hero_phrase"
        ? "statement"
        : replacement === "talk_sentences"
          ? "cards"
          : current.layoutIntent;
    const nextImageStrategy = current.imageStrategy;
    const preservedVisualLayout = current.imageStrategy === "real_photo" || current.imageStrategy === "diagram";
    balanced[index] = {
      ...current,
      sceneTextMode: replacement,
      layoutIntent: preservedVisualLayout ? current.layoutIntent : nextLayout,
      imageStrategy: nextImageStrategy,
      visualPrompt: completeVisualPrompt(
        project,
        plan,
        nextImageStrategy,
        preservedVisualLayout ? current.layoutIntent : nextLayout,
        current.visualPrompt,
      ),
    };
  }
  return balanced;
}

export function buildDeckStory(project: ProjectInput, researchBrief: ResearchBrief, narrativePlan: SlideNarrative[], sources: Source[] = []): DeckStory {
  const topic = projectTopic(project);
  const plans = narrativePlan.length
    ? narrativePlan
    : Array.from({ length: project.slideCount }, (_, index) => buildFallbackNarrativeItem(project, index + 1));
  const chapterSize = Math.max(1, Math.ceil(plans.length / 3));
  const chapters = Array.from({ length: Math.ceil(plans.length / chapterSize) }, (_, index) => {
    const items = plans.slice(index * chapterSize, (index + 1) * chapterSize);
    const first = items[0] || plans[0];
    return {
      title: first?.slideTitle || `${topic} chapter ${index + 1}`,
      purpose: first?.slidePurpose || `Explain part ${index + 1} of ${topic}.`,
      slideOrders: items.map((item) => item.slideOrder),
    };
  });
  const finalPlan = plans[plans.length - 1];

  return deckStorySchema.parse({
    mainIdea: finalPlan?.keyMessage || researchBrief.angle || topic,
    audienceQuestion: plans[0]?.audienceQuestion || `What should the audience understand about ${topic}?`,
    tone: deckStoryTone(project),
    chapters,
    conclusion: finalPlan?.keyMessage || `The conclusion should stay focused on ${topic}.`,
    factualTopicProfile: buildFactualTopicProfile(project, sources, "", plans),
  });
}

export function deckStoryTone(project: ProjectInput): DeckStory["tone"] {
  const text = `${project.scenario} ${project.level} ${project.prompt}`.toLowerCase();
  if (text.includes("university_report") || text.includes("university_student")) return "college_report";
  if (text.includes("exam") || text.includes("экзам") || text.includes("егэ") || text.includes("огэ")) return "exam_explanation";
  if (text.includes("teacher") || text.includes("lesson") || text.includes("учител") || text.includes("урок")) return "teacher_explainer";
  if (text.includes("college") || text.includes("универс") || text.includes("студент")) return "college_report";
  return "college_report";
}

export function buildSlideBlueprints(
  project: ProjectInput,
  narrationText: string,
  narrativePlan: SlideNarrative[],
  designBrief: DesignBrief,
  options?: { acceptedFullNarration?: boolean },
): SlideBlueprint[] {
  const sections = options?.acceptedFullNarration
    ? parseNarrationSections(narrationText)
    : parseNarrationSections(normalizeNarrationText(narrationText, project));
  if (options?.acceptedFullNarration && (
    sections.length !== project.slideCount
    || sections.some((section, index) => section.order !== index + 1 || !section.title || !section.text.trim())
  )) {
    throw new Error("Accepted narration does not contain one complete section per slide");
  }
  return Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, order);
    const section = sections[index];
    const layoutCandidate = order === 1 ? "hero" : order === project.slideCount ? "summary" : CONTENT_LAYOUT_CYCLE[(order - 2) % CONTENT_LAYOUT_CYCLE.length];
    const sentenceTotal = sentenceCount(section?.text || "");
    return slideBlueprintSchema.parse({
      slideOrder: order,
      purpose: plan.slidePurpose,
      title: section?.title || plan.slideTitle,
      visualStrategy: `${designBrief.mood} ${layoutCandidate} slide focused on ${plan.keyMessage}`,
      layoutCandidate,
      textDensity: sentenceTotal >= 6 ? "high" : sentenceTotal <= 3 ? "low" : "medium",
    });
  });
}

export function buildSlideTextPlans(
  project: ProjectInput,
  narrationText: string,
  narrativePlan: SlideNarrative[],
  deckStory: DeckStory,
  sources: Source[],
  options?: { acceptedFullNarration?: boolean },
): SlideTextPlan[] {
  // Full-document narration has already passed its own v6/v7 contract before
  // this stage. Its distribution targets are intentionally soft, so sending
  // it through the legacy per-slide ceiling can reject a valid accepted draft
  // (for example a 117-word opening against the former 108-word ceiling).
  const sections = options?.acceptedFullNarration
    ? parseNarrationSections(narrationText)
    : parseNarrationSections(normalizeNarrationText(narrationText, project));
  if (options?.acceptedFullNarration && (
    sections.length !== project.slideCount
    || sections.some((section, index) => section.order !== index + 1 || !section.title || !section.text.trim())
  )) {
    throw new Error("Accepted narration does not contain one complete section per slide");
  }
  return Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const plan = narrativePlan[index] || buildFallbackNarrativeItem(project, order);
    const section = sections[index];
    const notes = completeNarrationSentences(section?.text || plan.keyMessage || deckStory.mainIdea).slice(0, 7).join(" ");
    const sourceHint = sourceEvidenceForSlide(sources, order);
    const supportedFactSourceIds = sourceHint && sources.length ? [sources[(order - 1) % sources.length].id] : [];
    const coreClaim = shortenSentence(firstSentence(notes) || plan.keyMessage || deckStory.mainIdea, 180);
    const evidenceOrExample = sourceHint || shortenSentence(secondSentence(notes), 160);
    const listenerTakeaway = shortenSentence(lastSentence(notes) || plan.keyMessage || deckStory.conclusion, 180);
    const title = shortenVisibleTitle(section?.title || plan.slideTitle || fallbackTitle(project, order));
    const thesis = ensureSentence(shortenSentence(coreClaim, 170));
    const bullets = compressVisibleSlideText([evidenceOrExample, listenerTakeaway, plan.audienceQuestion])
      .filter((item) => item && normalizeTitleKey(item) !== normalizeTitleKey(title))
      .slice(0, order === project.slideCount ? 3 : 2);

    return slideTextPlanSchema.parse({
      slideOrder: order,
      slideQuestion: plan.audienceQuestion,
      coreClaim,
      evidenceOrExample,
      listenerTakeaway,
      title,
      thesis,
      bullets,
      speakerNotes: notes,
      supportedFactSourceIds,
      entityAssertions: [],
    });
  });
}

export function compressVisibleSlideText(values: string[]) {
  return values
    .map((value) => shortenSentence(cleanText(value), 92))
    .map((value) => value.replace(/[.!?]+$/g, ""))
    .filter((value) =>
      wordCount(value) >= 2 &&
      wordCount(value) <= 14 &&
      isCompleteScreenSentence(value) &&
      !hasGenericOrMetaScreenText(value) &&
      !looksLikeSentenceFragment(value),
    );
}

export function sourceEvidenceForSlide(sources: Source[], order: number) {
  if (!sources.length) return "";
  const source = sources[(order - 1) % sources.length];
  return completeSourceSentence(source.excerpt || source.label, 160);
}

function completeSourceSentence(value: unknown, maxLength: number) {
  const text = cleanText(value);
  return isCompleteScreenSentence(text) && /[.!?]$/.test(text) ? shortenSentence(text, maxLength) : "";
}

export function shortenVisibleTitle(value: string) {
  const title = cleanText(value).replace(/[.!?]+$/g, "");
  const words = title.split(/\s+/).filter(Boolean);
  return words.length > 8 ? words.slice(0, 8).join(" ") : title;
}

export function ensureSentence(value: string) {
  const text = cleanText(value);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function secondSentence(value: string) {
  return value.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)[1] || "";
}

export function buildQualityCritique(presentation: PresentationDocument, issues: SlideTextIssue[]): QualityCritique {
  return qualityCritiqueSchema.parse({
    score: issues.length ? Math.max(0, 100 - issues.length * 20) : 100,
    summary: issues.length ? `${issues.length} slide text issue(s) found.` : "No slide text issues found.",
    issues: issues.flatMap((issue) =>
      issue.reasons.map((reason) => ({
        slideId: presentation.slides.find((slide) => slide.order === issue.slideOrder)?.id,
        severity: "major",
        category: reason.includes("duplicated") ? "duplicate" : "generic_text",
        message: reason,
        field: issue.fields.join(", "),
        repairInstruction: `Repair fields: ${issue.fields.join(", ")}`,
      })),
    ),
  });
}

export function normalizeNarrativePlan(raw: unknown, project: ProjectInput): SlideNarrative[] {
  const value = parseNarrativePlanRaw(raw);
  const inputItems = Array.isArray(value) ? value : [];
  const normalized: SlideNarrative[] = [];
  const timingBudget = getRussianStudentSpeechTimingBudget(project);

  for (let index = 0; index < project.slideCount; index += 1) {
    const order = index + 1;
    const rawItem = inputItems[index] && typeof inputItems[index] === "object" ? (inputItems[index] as Partial<SlideNarrative>) : {};
    const fallback = buildFallbackNarrativeItem(project, order);
    const slideTitle = cleanNarrativeField(rawItem.slideTitle, "title") || fallback.slideTitle;
    const item: SlideNarrative = {
      slideOrder: order,
      slideTitle,
      slidePurpose: cleanNarrativeField(rawItem.slidePurpose, "purpose") || fallback.slidePurpose,
      keyMessage: cleanNarrativeField(rawItem.keyMessage, "message") || fallback.keyMessage,
      audienceQuestion: cleanNarrativeField(rawItem.audienceQuestion, "question") || fallback.audienceQuestion,
      transitionToNext:
        order === project.slideCount
          ? ""
          : cleanNarrativeField(rawItem.transitionToNext, "transition") || fallback.transitionToNext,
      storyJob: cleanNarrativeField(rawItem.storyJob, "purpose") || cleanNarrativeField(rawItem.slidePurpose, "purpose") || fallback.storyJob || fallback.slidePurpose,
      supportedFactSourceIds: Array.isArray(rawItem.supportedFactSourceIds)
        ? rawItem.supportedFactSourceIds.filter((sourceId): sourceId is string => typeof sourceId === "string" && Boolean(sourceId.trim()))
        : [],
      entityAssertions: Array.isArray(rawItem.entityAssertions) ? rawItem.entityAssertions : [],
      bridgeFromPrevious: order === 1 ? "" : cleanNarrativeField(rawItem.bridgeFromPrevious, "transition"),
      evidenceOrExplanation: cleanNarrativeField(rawItem.evidenceOrExplanation, "message") || cleanNarrativeField(rawItem.keyMessage, "message") || fallback.keyMessage,
      whyItMatters: cleanNarrativeField(rawItem.whyItMatters, "purpose") || cleanNarrativeField(rawItem.slidePurpose, "purpose") || fallback.slidePurpose,
      speechWordTarget: timingBudget
        ? (order === 1 ? timingBudget.titleWordTarget : order === project.slideCount ? timingBudget.conclusionWordTarget : timingBudget.contentWordTarget)
        : undefined,
    };
    normalized.push(order === project.slideCount ? normalizeConclusionNarrativeItem(item, project) : item);
  }

  return normalized;
}

/**
 * A summary is a narrative job, not a courtesy slide. Keep the existing
 * SlideNarrative contract, but make its final item explicit enough for every
 * later stage (narration, screen text, and repair) to synthesize the deck.
 */
export function normalizeConclusionNarrativeItem(item: SlideNarrative, project: ProjectInput): SlideNarrative {
  const fallback = buildFallbackNarrativeItem(project, project.slideCount);
  const title = isGenericConclusionEnding(item.slideTitle) ? fallback.slideTitle : item.slideTitle;
  const keyMessage = isGenericConclusionEnding(item.keyMessage) ? fallback.keyMessage : item.keyMessage;
  const purpose = cleanText(item.slidePurpose);
  return {
    ...item,
    slideTitle: title,
    keyMessage,
    // The prompt still requires a strong synthesis, but these fields are also
    // narration input. Do not let a planner instruction become speaker text.
    slidePurpose: isConclusionPlanningInstruction(purpose) ? fallback.slidePurpose : purpose || fallback.slidePurpose,
    audienceQuestion: isGenericConclusionEnding(item.audienceQuestion) ? fallback.audienceQuestion : item.audienceQuestion,
    transitionToNext: "",
  };
}

function isConclusionPlanningInstruction(value: string) {
  const normalized = value.toLowerCase();
  return normalized.includes("собрать ответ на главный вопрос")
    || normalized.includes("связать его с предыдущими смысловыми шагами")
    || normalized.includes("оставить 2–3")
    || normalized.includes("оставить 2-3");
}

function isGenericConclusionEnding(value: unknown) {
  const text = cleanText(value).toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (!text) return true;
  return /^(?:спасибо(?:\s+за\s+внимание)?|вопросы\??|thank\s+you|questions\??|мы\s+рассмотрели.*)$/iu.test(text);
}

export function parseNarrativePlanRaw(raw: unknown) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw && typeof raw === "object") {
    const candidate = raw as { narrativePlan?: unknown };
    return Array.isArray(candidate.narrativePlan) ? candidate.narrativePlan : raw;
  }

  const text = cleanMultilineText(raw);
  if (!text) {
    return [];
  }

  try {
    const parsed = parseJsonText(text);
    return parseNarrativePlanRaw(parsed);
  } catch {
    return [];
  }
}

export function cleanNarrativeField(value: unknown, kind: "title" | "purpose" | "message" | "question" | "transition") {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  const lower = text.toLowerCase();
  const genericFragments = [
    "этот слайд",
    "данный слайд",
    "слайд показывает",
    "слайд рассказывает",
    "слайд объясняет",
    "переходим к следующему",
    "перейдем к следующему",
    "следующий слайд",
    "ключевые факты",
    "основные мысли",
  ];
  if (genericFragments.some((fragment) => lower.includes(fragment))) {
    return "";
  }

  if (kind === "title" && isGenericSlideTitle(normalizeTitleKey(text))) {
    return "";
  }

  if (kind !== "title" && text.split(/\s+/).filter(Boolean).length < 3) {
    return "";
  }

  return shortenSentence(text, kind === "title" ? 90 : 220);
}

export function buildFallbackNarrativeItem(project: ProjectInput, order: number, titleOverride = ""): SlideNarrative {
  const title = cleanText(titleOverride) || fallbackTitle(project, order);
  const topic = projectTopic(project);
  return {
    slideOrder: order,
    slideTitle: order === project.slideCount && isGenericConclusionEnding(title) ? `Что показывает ${topic}` : title,
    slidePurpose:
      order === 1
        ? `Задать понятный контекст темы «${topic}» и показать, с какого вопроса начинается выступление.`
        : order === project.slideCount
        ? `Показать, как ключевые аспекты темы «${topic}» образуют целостную картину и объясняют её значение.`
          : `Раскрыть важную часть темы «${topic}» через отдельный смысловой шаг выступления.`,
    keyMessage:
      order === project.slideCount
        ? `Ключевые аспекты темы «${topic}» вместе показывают её значение и связи между рассмотренными явлениями.`
        : `Тема «${topic}» становится понятнее через конкретный аспект: ${title}.`,
    audienceQuestion:
      order === 1
        ? `Почему тема «${topic}» важна для этого выступления?`
        : order === project.slideCount
          ? `Какой вывод нужно запомнить после выступления?`
          : `Что важно понять про «${title}»?`,
    transitionToNext:
      order === project.slideCount
        ? ""
        : `После «${title}» логично раскрыть следующий аспект темы «${topic}», чтобы сохранить последовательность объяснения.`,
    storyJob: order === project.slideCount
      ? "Синтезировать предыдущие смысловые шаги в один вывод без нового факта."
      : `Раскрыть отдельную роль в истории темы: ${title}.`,
    supportedFactSourceIds: [],
    entityAssertions: [],
    bridgeFromPrevious: order === 1 ? "" : `Link the preceding beat to ${title}.`,
    evidenceOrExplanation: `Explain the supported point about ${title}.`,
    whyItMatters: `Show how ${title} contributes to the central question.`,
  };
}
