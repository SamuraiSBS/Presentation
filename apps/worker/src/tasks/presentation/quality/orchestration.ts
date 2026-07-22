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
  findContentSlideContractIssues,
  improvePresentationQuality,
  productionQualityReleaseResult,
  rebuildGeneratedCanvases,
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
import { recordOpenAIResponse } from "../providers/generation.js";
import { shortenVisibleTitle, buildQualityCritique } from "../planning/builders.js";
import { requestYandexText, parseNarrationSections, validateNarrationSections, isUsableNarrationSentence, formatNarrationSection } from "../narration/processing.js";
import { normalizePresentation, normalizeSlide, fallbackTitle, sentenceCount, speechSentences, sentenceFragment, buildFallbackBulletItems, ensureRange, uniqueShortItems, splitIntoSentences, normalizeTitleKey, isDuplicateDisplayText, fallbackSlideText } from "../normalization/presentation.js";
import { parseJsonText, cleanGeneratedText, cleanMultilineText, cleanText, sanitizeSpeechText, shortenWords } from "../utilities.js";
import { jsonSchema, slideTextRepairSchema, qualityCritiqueJsonSchema, qualityRepairJsonSchema } from "../schemas.js";

export async function finalizeGeneratedPresentation(
  raw: unknown,
  project: ProjectInput,
  sources: Source[],
  generationMode: AiGenerationMode,
  generatedText: string,
  narrativePlan: SlideNarrative[],
  repair: (presentation: PresentationDocument, issues: SlideTextIssue[]) => Promise<unknown>,
  qualityCallbacks: QualityModelCallbacks = {},
  designBrief?: DesignBrief,
) {
  let presentation = preserveAcceptedNarration(
    normalizePresentation(raw, project, sources, generationMode, generatedText, narrativePlan, false, designBrief),
    generatedText,
    project,
  );
  let lastValidCandidate: PresentationDocument | null = null;
  let issues = findSlideTextIssues(presentation);

  if (issues.length) {
    try {
      const repaired = await repair(presentation, issues);
      presentation = applySlideTextRepairs(presentation, repaired, project);
    } catch (error) {
      logger.warn({ projectId: project.id, stage: "polishing", generationMode, ...errorLogFields(error) }, "slide text review failed; using narration fallback");
    }

    issues = findSlideTextIssues(presentation);
    if (issues.length) {
      presentation = preserveAcceptedNarration(
        applyNarrationFallbacks(presentation, issues, project),
        generatedText,
        project,
      );
      issues = findSlideTextIssues(presentation);
    }
  }

  if (issues.length) {
    logger.warn({
      projectId: project.id,
      stage: "polishing",
      generationMode,
      issues: issues.map((issue) => ({
        slideOrder: issue.slideOrder,
        fields: issue.fields,
        reasons: issue.reasons,
      })),
    }, "ai generation quality check found unresolved slide text issues; continuing with quality repair");
  }

  try {
    assertPresentationQuality(presentation, project, generationMode);
    assertNoForbiddenTemplateText(presentation);
    lastValidCandidate = presentation;
  } catch (error) {
    const locallyRepaired = repairPresentationNarrationLocally(presentation, project, generationMode);
    if (locallyRepaired) {
      presentation = preserveAcceptedNarration(locallyRepaired, generatedText, project);
      lastValidCandidate = presentation;
    } else if (!isRepairablePresentationQualityError(error)) {
      throw error;
    } else {
      logger.warn({
        projectId: project.id,
        stage: "polishing",
        generationMode,
        ...errorLogFields(error),
      }, "ai generation quality check found repairable presentation issues; continuing with quality repair");
    }
  }

  let improved = preserveAcceptedNarration(
    await improvePresentationQuality(presentation, project, sources, generationMode, qualityCallbacks),
    generatedText,
    project,
  );
  let finalIssues = findSlideTextIssues(improved);
  if (finalIssues.length) {
    improved = preserveAcceptedNarration(
      applyNarrationFallbacks(improved, finalIssues, project),
      generatedText,
      project,
    );
    finalIssues = findSlideTextIssues(improved);
  }
  const blockingFinalIssues = finalIssues.filter(isBlockingSlideTextIssue);
  if (blockingFinalIssues.length && !isDemoMode(generationMode)) {
    const error = new Error(`AI generation quality check failed: unresolved visible slide text: ${blockingFinalIssues.map((issue) => `slide ${issue.slideOrder} ${issue.reasons.join(", ")}`).join("; ")}`);
    if (!lastValidCandidate) throw error;
    logger.warn({
      projectId: project.id,
      stage: "polishing",
      generationMode,
      ...errorLogFields(error),
    }, "polishing left duplicate or invalid visible text; restoring the last valid candidate");
    return preserveAcceptedNarration(lastValidCandidate, generatedText, project);
  }
  const finalPresentation = finalIssues.length
    ? presentationSchema.parse({ ...improved, qualityCritique: buildQualityCritique(improved, finalIssues) })
    : improved;
  try {
    assertNoForbiddenTemplateText(finalPresentation);
    assertPresentationQuality(finalPresentation, project, generationMode);
  } catch (error) {
    if (!lastValidCandidate) throw error;
    logger.warn({
      projectId: project.id,
      stage: "polishing",
      generationMode,
      ...errorLogFields(error),
    }, "polishing regressed a validated presentation; restoring the last valid candidate");
    return preserveAcceptedNarration(lastValidCandidate, generatedText, project);
  }
  const released = rebuildGeneratedCanvases(preserveAcceptedNarration(finalPresentation, generatedText, project));
  const release = productionQualityReleaseResult(released, sources, project);
  logger.info({
    projectId: project.id,
    stage: "release_quality_gate",
    issueCategories: release.issueCategories,
    attempts: release.attempts,
    finalAction: release.finalDisposition,
  }, "presentation production quality gate");
  if (release.finalDisposition !== "released") {
    throw new Error(`Presentation production quality gate rejected the document: ${release.issueCategories.join(", ") || "quality threshold"}`);
  }
  return presentationSchema.parse({
    ...released,
    productionQualityGate: { version: 1, capability: "silent-production-quality-gate" },
  });
}

export function preserveAcceptedNarration(presentation: PresentationDocument, narrationText: string, project: ProjectInput): PresentationDocument {
  const acceptedGeneratedText = cleanGeneratedText(narrationText);
  const sections = parseNarrationSections(acceptedGeneratedText);
  if (sections.length !== project.slideCount || validateNarrationSections(sections, project).length) return presentation;

  const narrationByOrder = new Map(sections.map((section) => [section.order, section]));
  return preserveAcceptedGeneratedText({
    ...presentation,
    slides: presentation.slides.map((slide) => {
      const section = narrationByOrder.get(slide.order);
      return section ? { ...slide, speakerNotes: section.text } : slide;
    }),
    // Rebuild this projection by slide order rather than mutating its current
    // array. That prevents a missing or shifted item from moving narration to
    // a neighbouring slide and keeps the title aligned with normalized canvas.
    speechScript: presentation.slides.map((slide) => {
      const section = narrationByOrder.get(slide.order);
      return {
        slideOrder: slide.order,
        slideTitle: slide.title,
        text: section?.text || slide.speakerNotes,
      };
    }),
  }, acceptedGeneratedText);
}

export function preserveAcceptedGeneratedText(presentation: PresentationDocument, acceptedGeneratedText: string) {
  const accepted = cleanGeneratedText(acceptedGeneratedText);
  if (!accepted) return presentation;
  return presentationSchema.parse({
    ...presentation,
    generatedText: accepted,
  });
}

export function repairPresentationNarrationLocally(
  presentation: PresentationDocument,
  project: ProjectInput,
  _generationMode: AiGenerationMode | FallbackGenerationMode,
) {
  const sections = parseNarrationSections(presentation.generatedText);
  // A narration that reached this layer has already been accepted upstream.
  // Do not manufacture replacement sentences here: it would silently change
  // the canonical generatedText and can desynchronise section-to-slide mapping.
  if (!canLocallyRepairNarrationSections(sections, project) || validateNarrationSections(sections, project).length) {
    return null;
  }
  const canonical = sections.map((section) => formatNarrationSection(section)).join("\n\n");
  return preserveAcceptedNarration(presentation, canonical, project);
}

export function canLocallyRepairNarrationSections(sections: NarrationSection[], project: ProjectInput) {
  if (sections.length !== project.slideCount) return false;
  return sections.every((section, index) => {
    if (!section || section.order !== index + 1 || !section.title) return false;
    const sentences = speechSentences(section.text);
    if (sentences.length < 5) return false;
    if (sentences.length <= 6) return true;
    return sentences.filter((sentence) => isUsableNarrationSentence(sentence, section, project)).length >= 5;
  });
}

export async function repairSlideTextWithOpenAI(client: OpenAI, presentation: PresentationDocument, issues: SlideTextIssue[]) {
  const startedAt = new Date();
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "Ты редактор текста учебных слайдов. Исправляй только видимый текст слайдов. Не изменяй заметки докладчика, не добавляй факты и возвращай только JSON.",
      },
      {
        role: "user",
        content: buildSlideTextRepairPrompt(presentation, issues),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "studydeck_slide_text_repair",
        strict: false,
        schema: slideTextRepairSchema,
      },
    },
  });
  await recordOpenAIResponse(response, "slide_text_repair", "studydeck_slide_text_repair", startedAt);
  const typedResponse = response as typeof response & { output_parsed?: unknown };
  return typedResponse.output_parsed || parseJsonText(response.output_text || "");
}

export async function repairSlideTextWithYandex(apiKey: string, presentation: PresentationDocument, issues: SlideTextIssue[]) {
  const outputText = await requestYandexText(
    apiKey,
    "Ты редактор текста учебных слайдов. Исправляй только видимый текст слайдов. Не изменяй заметки докладчика, не добавляй факты и возвращай только JSON.",
    buildSlideTextRepairPrompt(presentation, issues),
    { jsonSchema: slideTextRepairSchema },
  );
  return parseJsonText(outputText);
}

export async function critiquePresentationQualityWithOpenAI(
  client: OpenAI,
  presentation: PresentationDocument,
  deterministic: QualityCritique,
) {
  const startedAt = new Date();
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: QUALITY_CRITIC_SYSTEM_PROMPT },
      { role: "user", content: buildQualityCriticPrompt(presentation, deterministic) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "studydeck_quality_critique",
        strict: true,
        schema: qualityCritiqueJsonSchema,
      },
    },
  });
  await recordOpenAIResponse(response, "quality_critique", "studydeck_quality_critique", startedAt);
  const typedResponse = response as typeof response & { output_parsed?: unknown };
  return typedResponse.output_parsed || parseJsonText(response.output_text || "");
}

export async function critiquePresentationQualityWithYandex(
  apiKey: string,
  presentation: PresentationDocument,
  deterministic: QualityCritique,
) {
  const outputText = await requestYandexText(
    apiKey,
    QUALITY_CRITIC_SYSTEM_PROMPT,
    buildQualityCriticPrompt(presentation, deterministic),
    { jsonSchema: qualityCritiqueJsonSchema, modelTier: "economy" },
  );
  return qualityCritiqueSchema.parse(parseJsonText(outputText));
}

export async function repairPresentationQualityWithOpenAI(
  client: OpenAI,
  presentation: PresentationDocument,
  issues: QualityIssue[],
  attempt: number,
): Promise<QualityRepairResponse> {
  const startedAt = new Date();
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: QUALITY_REPAIR_SYSTEM_PROMPT },
      { role: "user", content: buildQualityRepairPrompt(presentation, issues, attempt) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "studydeck_quality_repair",
        strict: false,
        schema: qualityRepairJsonSchema,
      },
    },
  });
  await recordOpenAIResponse(response, "quality_repair", "studydeck_quality_repair", startedAt);
  const typedResponse = response as typeof response & { output_parsed?: unknown };
  return (typedResponse.output_parsed || parseJsonText(response.output_text || "")) as QualityRepairResponse;
}

export async function repairPresentationQualityWithYandex(
  apiKey: string,
  presentation: PresentationDocument,
  issues: QualityIssue[],
  attempt: number,
): Promise<QualityRepairResponse> {
  const outputText = await requestYandexText(
    apiKey,
    QUALITY_REPAIR_SYSTEM_PROMPT,
    buildQualityRepairPrompt(presentation, issues, attempt),
    { jsonSchema: qualityRepairJsonSchema },
  );
  return parseJsonText(outputText) as QualityRepairResponse;
}

export function buildSlideTextRepairPrompt(presentation: PresentationDocument, issues: SlideTextIssue[]) {
  const slides = issues.map((issue) => {
    const slide = presentation.slides.find((candidate) => candidate.order === issue.slideOrder);
    return {
      slideOrder: issue.slideOrder,
      title: slide?.title,
      speakerNotes: slide?.speakerNotes,
      problems: issue.reasons,
      fields: issue.fields,
      current: slide
        ? {
            thesis: slide.thesis,
            bullets: slide.bullets,
            blocks: slide.blocks,
            definition: slide.definition,
            visual: {
              title: slide.visual.title,
              items: slide.visual.items,
              rows: slide.visual.rows,
              leftLabel: slide.visual.leftLabel,
              rightLabel: slide.visual.rightLabel,
            },
          }
        : null,
    };
  });

  return [
    "Перепиши только перечисленные проблемные слайды одним ответом.",
    "Текст должен быть понятным без заметок докладчика: законченные формулировки, конкретный смысл, без обрывков и метатекста о презентации.",
    "Сохрани факты и смысл speakerNotes. Не придумывай имена, даты, числа, причины или выводы, которых там нет.",
    "title можно менять только если поле title указано в problems/fields; speakerNotes и speechScript не меняй.",
    "Верни объект { slides: [...] }. Для каждого slideOrder верни полный набор title, thesis, bullets, blocks, definition и visual с исправленным видимым текстом.",
    JSON.stringify({ slides }),
  ].join("\n\n");
}

export function buildQualityCriticPrompt(presentation: PresentationDocument, deterministic: QualityCritique) {
  const slides = presentation.slides.map((slide) => ({
    id: slide.id,
    order: slide.order,
    title: slide.title,
    slideKind: slide.slideKind,
    layout: slide.layout,
    thesis: slide.thesis,
    bullets: slide.bullets,
    visual: {
      type: slide.visual.type,
      description: slide.visual.description,
    },
    speakerNotes: slide.speakerNotes,
    sourceRefs: slide.sourceRefs.map((ref) => ({ sourceId: ref.sourceId, label: ref.label })),
  }));

  return [
    "Evaluate the presentation. Do not rewrite it. Return only JSON with score, summary, dimensions and issues.",
    "Dimensions are speechNaturalness, universityTone, slideBrevity, visualRhythm, sourceGrounding and exportReadiness. Score each from 0 to 100 and give a short reason.",
    "Ask: can a university student read this aloud naturally; are slides brief; is visual rhythm intentional; are claims grounded; will export preserve the design?",
    "Use severity blocker, major or minor. Use category generic_text, off_topic, too_long, duplicate, bad_narration, bad_visual, factual_risk or schema_risk.",
    "Prefer field-level issues with slideId when a single slide can be repaired.",
    "Treat the project topic and narrative plan as the semantic source of truth. Flag an off-topic slide when its visible text only repeats the project name but then develops a different subject from the matching narration or narrative item.",
    "Do not quote or repeat full source text.",
    JSON.stringify({
      deterministic,
      deck: {
        title: presentation.title,
        scenario: presentation.scenario,
        level: presentation.level,
        slideCount: presentation.slideCount,
        outline: presentation.outline,
        narrativePlan: presentation.narrativePlan.map((item) => ({
          slideOrder: item.slideOrder,
          slideTitle: item.slideTitle,
          keyMessage: item.keyMessage,
        })),
        slides,
      },
    }),
  ].join("\n\n");
}

export function buildQualityRepairPrompt(presentation: PresentationDocument, issues: QualityIssue[], attempt: number) {
  const affectedSlideIds = new Set(issues.map((issue) => issue.slideId).filter(Boolean));
  const acceptedNarration = new Map(parseNarrationSections(presentation.generatedText).map((section) => [section.order, section.text]));
  const slides = presentation.slides
    .filter((slide) => !affectedSlideIds.size || affectedSlideIds.has(slide.id))
    .map((slide) => ({
      slideId: slide.id,
      slideOrder: slide.order,
      title: slide.title,
      slideKind: slide.slideKind,
      layout: slide.layout,
      thesis: slide.thesis,
      bullets: slide.bullets,
      blocks: slide.blocks,
      visual: {
        type: slide.visual.type,
        title: slide.visual.title,
        description: slide.visual.description,
        leftLabel: slide.visual.leftLabel,
        rightLabel: slide.visual.rightLabel,
        items: slide.visual.items,
        rows: slide.visual.rows,
      },
      speakerNotes: slide.speakerNotes,
      acceptedNarration: acceptedNarration.get(slide.order) || slide.speakerNotes,
      sourceRefs: slide.sourceRefs.map((ref) => ({ sourceId: ref.sourceId, label: ref.label })),
    }));

  return [
    `Repair attempt ${attempt}. Repair only the listed broken fields and slides.`,
    "Return JSON { slides: [...] }. Each slide item must include slideId or slideOrder plus changed fields only.",
    "You may change title, thesis, bullets, blocks, visual.description and speakerNotes when the issue explicitly requires it.",
    "For visual rhythm issues you may also choose a schema-valid layout and make the visual description concrete; the worker will rebuild generated canvases.",
    "For visual coverage or image-relevance issues, change the design direction toward a specific anchored photo or a useful diagram; never add a random stock image and never edit a user canvas.",
    "For weak speech, rewrite speakerNotes from the accepted narration and keep the matching speechScript aligned.",
    "For off_topic issues, preserve accepted narration exactly and rewrite every visible field only from that narration and the matching narrative-plan item. A topic word at the start does not make unrelated later text acceptable.",
    "Each visible field must be a complete standalone audience-facing formulation. Never start a bullet, block, or visual text as a continuation of another layout slot, and never leave it ending on a connector or incomplete predicate.",
    "Give every slide one distinct narrative-plan takeaway. Remove exact thesis/bullet or repeated visible copies; replace a repeated deck-level claim with that slide's own example, stage, cause, consequence, or conclusion.",
    "Replace template transitions, filler, and watery phrases with topic-specific causes, examples, consequences, concrete mechanisms, and a clear conclusion.",
    "Do not write about slide structure, transitions, next sections, or what the presentation will explain; write the actual subject matter.",
    "Do not invent precise facts, dates, names, numbers, or citations. Preserve existing sourceRefs.",
    "Keep slide text compact: title <= 12 words, thesis one sentence, bullets <= 18 words.",
    JSON.stringify({ issues, slides }),
  ].join("\n\n");
}

export function applySlideTextRepairs(
  presentation: PresentationDocument,
  rawRepairs: unknown,
  project: ProjectInput,
): PresentationDocument {
  const response = rawRepairs && typeof rawRepairs === "object" ? (rawRepairs as SlideTextRepairResponse) : {};
  const repairs = Array.isArray(response.slides) ? response.slides : [];
  if (!repairs.length) return presentation;

  const narrationSections = parseNarrationSections(presentation.generatedText);
  const slides = presentation.slides.map((slide, index) => {
    const repair = repairs.find((candidate) => Number(candidate?.slideOrder) === slide.order);
    if (!repair) return slide;
    return normalizeSlide(
      {
        ...slide,
        title: repair.title ?? slide.title,
        thesis: repair.thesis ?? slide.thesis,
        bullets: repair.bullets ?? slide.bullets,
        blocks: repair.blocks ?? slide.blocks,
        definition: repair.definition ?? slide.definition,
        visual: repair.visual ? { ...slide.visual, ...(repair.visual as Partial<SlideVisual>) } : slide.visual,
        speakerNotes: slide.speakerNotes,
      },
      slide.order,
      presentation.sources,
      project,
      narrationSections[index],
    );
  });

  return presentationSchema.parse({ ...presentation, slides });
}

export function applyNarrationFallbacks(
  presentation: PresentationDocument,
  issues: SlideTextIssue[],
  project: ProjectInput,
): PresentationDocument {
  const issueMap = new Map(issues.map((issue) => [issue.slideOrder, issue]));
  const narrationSections = parseNarrationSections(presentation.generatedText);
  const slides = presentation.slides.map((slide, index) => {
    const issue = issueMap.get(slide.order);
    if (!issue) return slide;

    const sentences = completeNarrationSentences(slide.speakerNotes);
    const existingBullet = slide.bullets.find(
      (item, itemIndex) =>
        !issue.fields.includes(`bullets.${itemIndex}`) &&
        !hasGenericOrMetaScreenText(item) &&
        !looksLikeSentenceFragment(item),
    );
    const fallbackThesis = existingBullet
      ? shortenCompleteSentence(`${slide.title}: ${sentenceFragment(existingBullet)}`, 18)
      : sentences[0] || slide.thesis || fallbackSlideText(project, slide.order);
    const title = issue.fields.includes("title")
      ? shortenVisibleTitle(narrationSections[index]?.title || fallbackTitle(project, slide.order))
      : slide.title;
    const thesis = issue.fields.includes("thesis") ? fallbackThesis : slide.thesis;
    const bullets = uniqueShortItems(sentences.slice(1, 5)).filter((item) => !isDuplicateDisplayText(item, thesis));
    const safeBullets = ensureRange(
      bullets,
      buildFallbackBulletItems(project, slide.order, slide.speakerNotes),
      slide.slideKind === "summary" ? 3 : 2,
      slide.slideKind === "summary" ? 5 : 3,
    );
    const repairedBullets = issue.fields.some((field) => field.startsWith("bullets.")) ? safeBullets : slide.bullets;
    const repairedBlocks = issue.fields.some((field) => field.startsWith("blocks."))
      ? [{ type: "bullets" as const, items: safeBullets }]
      : slide.blocks;
    const repairedDefinition = slide.definition
      ? {
          term: issue.fields.includes("definition.term") ? safeLabelFromSentence(fallbackThesis) : slide.definition.term,
          text: issue.fields.includes("definition.text") ? fallbackThesis : slide.definition.text,
        }
      : null;

    const repairedVisual = {
      ...slide.visual,
      title: issue.fields.includes("visual.title") ? "" : slide.visual.title,
      items: slide.visual.items.map((item, itemIndex) => ({
        label: issue.fields.includes(`visual.items.${itemIndex}.label`) ? safeLabelFromSentence(sentences[itemIndex + 1] || thesis) : item.label,
        text: issue.fields.includes(`visual.items.${itemIndex}.text`) ? sentences[itemIndex + 1] || thesis : item.text,
      })),
      rows: slide.visual.rows.map((row, rowIndex) => ({
        label: issue.fields.includes(`visual.rows.${rowIndex}.label`) ? safeLabelFromSentence(sentences[rowIndex + 1] || thesis) : row.label,
        left: issue.fields.includes(`visual.rows.${rowIndex}.left`) ? sentences[rowIndex + 1] || thesis : row.left,
        right: issue.fields.includes(`visual.rows.${rowIndex}.right`) ? sentences[rowIndex + 2] || sentences[0] || thesis : row.right,
      })),
    };

    return normalizeSlide(
      {
        ...slide,
        title,
        thesis,
        bullets: repairedBullets,
        blocks: repairedBlocks,
        definition: repairedDefinition,
        visual: repairedVisual,
        speakerNotes: slide.speakerNotes,
      },
      slide.order,
      presentation.sources,
      project,
      narrationSections[index],
    );
  });

  return presentationSchema.parse({ ...presentation, slides });
}

export function findSlideTextIssues(presentation: PresentationDocument): SlideTextIssue[] {
  return presentation.slides
    .map((slide) => inspectSlideText(slide))
    .filter((issue): issue is SlideTextIssue => Boolean(issue));
}

export function inspectSlideText(slide: Slide): SlideTextIssue | null {
  const entries = visibleSlideTextEntries(slide);
  const fields = new Set<string>();
  const reasons = new Set<string>();
  const seen = new Map<string, string>();

  for (const entry of entries) {
    const text = cleanText(entry.text);
    if (!text) continue;

    if (hasGenericOrMetaScreenText(text)) {
      fields.add(entry.field);
      reasons.add("generic or meta text");
    }

    if (!entry.label && looksLikeSentenceFragment(text)) {
      fields.add(entry.field);
      reasons.add("sentence fragment");
    }

    if (!entry.label && isNarrativeScreenField(entry.field) && isWeaklyRelatedToNarration(text, slide)) {
      fields.add(entry.field);
      reasons.add("text is weakly related to speaker notes");
    }

    const normalizedText = normalizeForQuality(text);
    const key = `${entry.group}:${normalizedText}`;
    if (normalizedText && normalizedText === normalizeForQuality(slide.title) && entry.field !== "title" && entry.field !== "definition.term") {
      fields.add(entry.field);
      reasons.add("text duplicates the slide title");
    } else if (key && seen.has(key)) {
      fields.add(entry.field);
      fields.add(seen.get(key)!);
      reasons.add("visible text is duplicated");
    } else if (key) {
      seen.set(key, entry.field);
    }
  }

  return fields.size
    ? {
        slideOrder: slide.order,
        fields: [...fields],
        reasons: [...reasons],
      }
    : null;
}

export function isBlockingSlideTextIssue(issue: SlideTextIssue) {
  return issue.reasons.some((reason) =>
    reason === "generic or meta text" ||
    reason === "sentence fragment" ||
    reason === "text duplicates the slide title" ||
    reason === "visible text is duplicated",
  );
}

export function isNarrativeScreenField(field: string) {
  return field === "thesis" || field.startsWith("bullets.") || field.startsWith("blocks.") || field === "definition.text";
}

export function visibleSlideTextEntries(slide: Slide) {
  return [
    { field: "title", text: slide.title, label: true, group: "title" },
    { field: "thesis", text: slide.thesis, label: false, group: "thesis" },
    ...slide.bullets.map((text, index) => ({ field: `bullets.${index}`, text, label: false, group: "bullets" })),
    ...slide.blocks.flatMap((block, index) =>
      block.type === "bullets"
        ? block.items.map((text, itemIndex) => ({ field: `blocks.${index}.items.${itemIndex}`, text, label: false, group: `block-${index}` }))
        : [{ field: `blocks.${index}.content`, text: block.content, label: false, group: `block-${index}` }],
    ),
    ...(slide.definition
      ? [
          { field: "definition.term", text: slide.definition.term, label: true, group: "definition" },
          { field: "definition.text", text: slide.definition.text, label: false, group: "definition" },
        ]
      : []),
    { field: "visual.title", text: slide.visual.title, label: true, group: "visual-title" },
    ...slide.visual.items.flatMap((item, index) => [
      { field: `visual.items.${index}.label`, text: item.label, label: true, group: "visual-item-labels" },
      { field: `visual.items.${index}.text`, text: item.text, label: false, group: "visual-item-texts" },
    ]),
    ...slide.visual.rows.flatMap((row, index) => [
      { field: `visual.rows.${index}.label`, text: row.label, label: true, group: "visual-row-labels" },
      { field: `visual.rows.${index}.left`, text: row.left, label: false, group: "visual-row-left" },
      { field: `visual.rows.${index}.right`, text: row.right, label: false, group: "visual-row-right" },
    ]),
    { field: "visual.leftLabel", text: slide.visual.leftLabel, label: true, group: "visual-columns" },
    { field: "visual.rightLabel", text: slide.visual.rightLabel, label: true, group: "visual-columns" },
  ];
}

export function hasGenericOrMetaScreenText(value: string) {
  const normalized = normalizeExactForQuality(value);
  if (hasForbiddenTemplateText(value)) {
    return true;
  }
  if (GENERIC_SCREEN_TEXT_PHRASES.some((phrase) => normalized.includes(normalizeExactForQuality(phrase)))) {
    return true;
  }
  return /\b(презентаци|слайд|заметк|докладчик|текст на экран|можно вынести следующее)\w*/iu.test(value);
}

export function looksLikeSentenceFragment(value: string) {
  const text = cleanText(value);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return true;
  if (/(?:…|\.\.\.)\s*$/.test(text)) return true;
  if (/[,;:\-–—]$/.test(text)) return true;
  if (hasDanglingPredicateModifier(text)) return true;
  return /^(\u043a\u043e\u0442\u043e\u0440\u044b\u0439|\u043a\u043e\u0442\u043e\u0440\u0430\u044f|\u043a\u043e\u0442\u043e\u0440\u043e\u0435|\u043a\u043e\u0442\u043e\u0440\u044b\u0435|\u043f\u043e\u0442\u043e\u043c\u0443 \u0447\u0442\u043e)\b/iu.test(text);
}

export function hasDanglingPredicateModifier(value: string) {
  const text = cleanText(value).replace(/[.!?]+$/g, "").toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const last = words.at(-1) || "";
  if (words.length < 4) return false;
  const hasPredicateSetup = /(?:^|[^\p{L}])(\u044d\u0442\u043e|\u044d\u0442\u0430|\u044d\u0442\u043e\u0442|\u044d\u0442\u0438|\u044f\u0432\u043b\u044f\u0435\u0442\u0441\u044f|\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0441\u044f|\u043e\u0441\u0442\u0430\u0435\u0442\u0441\u044f|\u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f|\u0431\u044b\u043b\u0430|\u0431\u044b\u043b|\u0431\u044b\u043b\u043e|\u0431\u0443\u0434\u0435\u0442|\u0441\u0442\u0430\u043b\u0430|\u0441\u0442\u0430\u043b|\u0441\u0442\u0430\u043b\u043e)(?=$|[^\p{L}])/iu.test(text);
  return hasPredicateSetup && /(\u0430\u044f|\u044f\u044f|\u044b\u0439|\u0438\u0439|\u043e\u0439|\u043e\u0435|\u0435\u0435|\u044b\u0435|\u0438\u0435|\u0443\u044e|\u044e\u044e|\u043e\u0433\u043e|\u0435\u0433\u043e|\u043e\u043c\u0443|\u0435\u043c\u0443|\u044b\u043c|\u0438\u043c|\u044b\u0445|\u0438\u0445)$/.test(last);
}

export function isWeaklyRelatedToNarration(value: string, slide: Slide) {
  const valueTokens = new Set(significantTokens(value));
  if (valueTokens.size < 6) return false;
  const narrationTokens = new Set(significantTokens(`${slide.title} ${slide.speakerNotes}`));
  if (!narrationTokens.size) return false;
  const overlap = [...valueTokens].filter((token) => narrationTokens.has(token)).length;
  return overlap === 0;
}

export function completeNarrationSentences(value: string) {
  return speechSentences(sanitizeSpeechText(value))
    .filter(isCompleteScreenSentence)
    .map((sentence) => shortenCompleteSentence(sentence, 18));
}

export function firstCompleteScreenSentence(value: string) {
  return splitIntoSentences(value).find(isCompleteScreenSentence) || "";
}

export function isCompleteScreenSentence(value: string) {
  const text = cleanText(value);
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 4 && !/[,;:\-–—]$/.test(text) && !looksLikeSentenceFragment(text);
}

export function shortenCompleteSentence(value: string, maxWords: number) {
  const text = cleanText(value);
  const words = text.replace(/[.!?]+$/g, "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return /[.!?]$/.test(text) ? text : `${text}.`;
  return `${words.slice(0, maxWords).join(" ")}.`;
}

export function safeLabelFromSentence(value: string) {
  return shortenWords(cleanText(value).replace(/[.!?]+$/g, ""), 5);
}

export function normalizeProvider(value: string | undefined): AiGenerationMode | undefined {
  const normalized = value?.toLowerCase().trim();
  return normalized === "openai" || normalized === "yandex" ? normalized : undefined;
}

export function isDemoGenerationAllowed() {
  return process.env.ALLOW_DEMO_GENERATION === "true";
}

export function isDemoMode(mode: AiGenerationMode | FallbackGenerationMode) {
  return mode === "demo" || mode === "demo-fallback";
}

export function assertRawGenerationQuality(input: Partial<PresentationDocument>, project: ProjectInput, mode: AiGenerationMode | FallbackGenerationMode) {
  if (isDemoMode(mode)) return;

  const allText = collectRawPresentationText(input);
  if (!allText) {
    throw new Error("AI generation quality check failed: response has no usable presentation text");
  }

  const rawSlideCount = Array.isArray(input.slides) ? input.slides.length : 0;
  const generatedTextSlideCount = countGeneratedTextSlides(input.generatedText);
  if (Math.max(rawSlideCount, generatedTextSlideCount) < project.slideCount) {
    throw new Error("AI generation quality check failed: response does not contain all requested slides");
  }

  const narrationText = collectRawNarrationText(input);
  const issues = qualityIssuesForText(narrationText || allText, project);
  if (issues.length) {
    throw new Error(`AI generation quality check failed: ${issues.join("; ")}`);
  }
}

export function assertPresentationQuality(presentation: PresentationDocument, project: ProjectInput, mode: AiGenerationMode | FallbackGenerationMode) {
  if (isDemoMode(mode)) return;

  const issues = qualityIssuesForText(visiblePresentationText(presentation), project, false);
  const slideTextIssues = findSlideTextIssues(presentation);
  const blockingSlideTextIssues = slideTextIssues.filter(isBlockingSlideTextIssue);
  if (blockingSlideTextIssues.length) {
    issues.push(...blockingSlideTextIssues.map((issue) => `slide ${issue.slideOrder} visible text ${issue.reasons.join(", ")}`));
  }
  const contentContractIssues = findContentSlideContractIssues(presentation);
  if (contentContractIssues.length) {
    issues.push(...contentContractIssues.map((issue) => `slide ${presentation.slides.find((slide) => slide.id === issue.slideId)?.order || "?"} ${issue.message}`));
  }

  if (!/Слайд\s+1\s*:/i.test(presentation.generatedText)) {
    issues.push("generatedText is not divided into slide narration");
  }

  const narrationIssues = validateNarrationSections(parseNarrationSections(presentation.generatedText), project);
  if (narrationIssues.length) {
    issues.push(...narrationIssues);
  }

  for (const slide of presentation.slides) {
    const count = sentenceCount(slide.speakerNotes);
    if (count < 2 || count > 7) {
      issues.push(`slide ${slide.order} speakerNotes must have 2-7 sentences`);
    }
  }

  for (const item of presentation.speechScript) {
    const count = sentenceCount(item.text);
    if (count < 2 || count > 7) {
      issues.push(`slide ${item.slideOrder} speechScript must have 2-7 sentences`);
    }
  }

  const genericTitleCount = presentation.slides.filter((slide) => isGenericDeckTitle(slide.title)).length;
  if (genericTitleCount >= 3) {
    issues.push("too many generic slide titles");
  }

  if (countHighlySimilarAdjacentSlides(presentation.slides) >= 2) {
    issues.push("neighboring slides are too similar");
  }

  const thinSlides = presentation.slides.filter((slide) => slide.slideKind !== "section" && lacksConcreteDetail(slide, project)).length;
  if (presentation.slides.length >= 4 && thinSlides > Math.max(1, Math.floor(presentation.slides.length * 0.35))) {
    issues.push("too many slides lack concrete subject details");
  }

  if (issues.length) {
    throw new Error(`AI generation quality check failed: ${uniqueIssues(issues).join("; ")}`);
  }
}

export function assertNoForbiddenTemplateText(presentation: PresentationDocument) {
  const bannedPhrase = findForbiddenTemplatePhrase(visiblePresentationText(presentation));
  if (bannedPhrase) {
    throw new Error(`AI generation quality check failed: template phrase detected: ${bannedPhrase}`);
  }
}

export function isRepairablePresentationQualityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (!message.startsWith("AI generation quality check failed:")) return false;
  const blockingFragments = [
    "generatedText is not divided into slide narration",
    "expected ",
    "missing narration section",
    "has no title",
    "must have 2-7 narration sentences",
    "speakerNotes must have 2-7 sentences",
    "speechScript must have 2-7 sentences",
  ];
  return !blockingFragments.some((fragment) => message.includes(fragment));
}

export function collectRawNarrationText(input: Partial<PresentationDocument>) {
  const slides = Array.isArray(input.slides) ? input.slides : [];
  const speechScript = Array.isArray(input.speechScript) ? input.speechScript : [];
  return cleanMultilineText(
    [
      input.generatedText,
      ...slides.map((slide) => (slide as Partial<Slide>).speakerNotes),
      ...speechScript.map((item) => item?.text),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function collectRawPresentationText(input: Partial<PresentationDocument>) {
  const slides = Array.isArray(input.slides) ? input.slides : [];
  const speechScript = Array.isArray(input.speechScript) ? input.speechScript : [];
  return cleanMultilineText(
    [
      input.title,
      input.generatedText,
      ...slides.flatMap((slide) => {
        const candidate = slide as Partial<Slide>;
        return [
          candidate.title,
          candidate.thesis,
          candidate.speakerNotes,
          ...(Array.isArray(candidate.bullets) ? candidate.bullets : []),
          ...(Array.isArray(candidate.blocks)
            ? candidate.blocks.flatMap(rawBlockText)
            : []),
        ];
      }),
      ...speechScript.flatMap((item) => [item?.slideTitle, item?.text]),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function rawBlockText(block: unknown): string[] {
  if (typeof block === "string") {
    return [block];
  }
  if (!block || typeof block !== "object") {
    return [];
  }

  const candidate = block as { type?: unknown; items?: unknown; content?: unknown };
  if (candidate.type === "bullets" && Array.isArray(candidate.items)) {
    return candidate.items.filter((item): item is string => typeof item === "string");
  }
  return typeof candidate.content === "string" ? [candidate.content] : [];
}

export function countGeneratedTextSlides(value: unknown) {
  const matches = cleanMultilineText(value).match(/(?:^|\n)Слайд\s+\d+\s*:/gi);
  return matches?.length || 0;
}

export function pickCanonicalGeneratedText(primary: unknown, secondary: unknown) {
  const primaryText = cleanMultilineText(primary);
  const secondaryText = cleanMultilineText(secondary);
  return secondaryText || primaryText;
}

export function visiblePresentationText(presentation: PresentationDocument) {
  return cleanMultilineText(
    [
      presentation.title,
      presentation.generatedText,
      ...presentation.slides.flatMap((slide) => [
        slide.title,
        slide.thesis,
        slide.speakerNotes,
        ...slide.bullets,
        ...(slide.definition ? [slide.definition.term, slide.definition.text] : []),
        slide.visual.title,
        slide.visual.description,
        ...slide.visual.items.flatMap((item) => [item.label, item.text]),
        ...slide.visual.rows.flatMap((row) => [row.label, row.left, row.right]),
        ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
      ]),
      ...presentation.speechScript.flatMap((item) => [item.slideTitle, item.text]),
    ].join("\n"),
  );
}

export function qualityIssuesForText(value: string, project: ProjectInput, checkPromptRepeat = true) {
  const issues: string[] = [];
  const text = normalizeForQuality(value);
  const lowerText = cleanText(value).toLowerCase().replace(/ё/g, "е");

  if (!text) return ["empty presentation text"];
  if (text.startsWith("{")) issues.push("model returned JSON text instead of presentation prose");

  const bannedPhrase = findForbiddenTemplatePhrase(value);
  if (bannedPhrase) {
    issues.push(`template phrase detected: ${bannedPhrase}`);
  }

  const prompt = normalizeExactForQuality(project.prompt);
  if (checkPromptRepeat && prompt.length >= 18 && countOccurrences(lowerText, prompt) > 1) {
    issues.push("user request is repeated instead of answered");
  }

  return issues;
}

export function isGenericDeckTitle(title: string) {
  return GENERIC_TITLES.includes(normalizeTitleKey(title));
}

export function countHighlySimilarAdjacentSlides(slides: Slide[]) {
  let count = 0;
  for (let index = 1; index < slides.length; index += 1) {
    const previous = slideSemanticText(slides[index - 1]);
    const current = slideSemanticText(slides[index]);
    if (textSimilarity(previous, current) >= 0.72) {
      count += 1;
    }
  }
  return count;
}

export function lacksConcreteDetail(slide: Slide, project: ProjectInput) {
  const promptTokens = significantTokens(project.prompt);
  const slideTokens = significantTokens(slideSemanticText(slide)).filter((token) => !promptTokens.includes(token));
  const hasNumber = /\d/.test(slideSemanticText(slide));
  const hasCapitalizedDetail = /[A-ZА-ЯЁ][a-zа-яё]+(?:\s+[A-ZА-ЯЁ][a-zа-яё]+)?/.test(slideSemanticText(slide).replace(/^Слайд\s+\d+/i, ""));
  return !hasNumber && !hasCapitalizedDetail && new Set(slideTokens).size < 4;
}

export function slideSemanticText(slide: Slide) {
  return [
    slide.title,
    slide.thesis,
    ...slide.bullets,
    ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
  ].join(" ");
}

export function textSimilarity(left: string, right: string) {
  const leftTokens = new Set(significantTokens(left));
  const rightTokens = new Set(significantTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

export function significantTokens(value: string) {
  return normalizeForQuality(value)
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi, ""))
    .filter((word) => word.length >= 5 && !STOP_WORDS.has(word));
}

export function normalizeForQuality(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”'`]/g, "")
    .replace(/[.,!?;:()[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeExactForQuality(value: string) {
  return cleanText(value).toLowerCase().replace(/ё/g, "е");
}

export function findForbiddenTemplatePhrase(value: string) {
  const lowerText = normalizeExactForQuality(value);
  const bannedPhrase = [...GENERIC_NARRATION_PHRASES, ...GENERIC_SCREEN_TEXT_PHRASES].find((phrase) => {
    const candidate = normalizeExactForQuality(phrase);
    return candidate.length >= 8 && lowerText.includes(candidate);
  });
  if (bannedPhrase) return bannedPhrase;

  return TEMPLATE_TEXT_PATTERNS.find(({ pattern }) => pattern.test(lowerText))?.label || "";
}

export function hasForbiddenTemplateText(value: string) {
  return Boolean(findForbiddenTemplatePhrase(value));
}

export function countOccurrences(text: string, needle: string) {
  if (!text || !needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

export function uniqueIssues(issues: string[]) {
  return [...new Set(issues)];
}
