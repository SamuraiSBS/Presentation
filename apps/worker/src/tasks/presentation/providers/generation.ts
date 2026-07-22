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
  getRussianStudentSpeechTimingBudget,
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
  yandexModelTier?: YandexModelTier;
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

// One first pass plus the three automatic paid recovery attempts agreed for
// narration. This is deliberately separate from BullMQ transport retries.
export const NARRATION_MAX_PROVIDER_ATTEMPTS = 4;
export const NARRATION_RECOVERY_CHUNK_COUNT = 3;

import type { YandexCompletionResponse } from "../constants.js";
import { STUDENT_CREATION_BRIEF_LINES, NARRATION_SYSTEM_PROMPT, SYSTEM_PROMPT, QUALITY_CRITIC_SYSTEM_PROMPT, QUALITY_REPAIR_SYSTEM_PROMPT, GENERIC_NARRATION_PHRASES, GENERIC_SCREEN_TEXT_PHRASES, TEMPLATE_TEXT_PATTERNS, GENERIC_TITLES, STOP_WORDS, REMOVED_SLIDE_LAYOUTS, SLIDE_LAYOUTS, CONTENT_LAYOUT_CYCLE } from "../constants.js";
import { buildResearchBrief, buildDesignBrief, logStructuredGenerationValidationFailure, buildDeckStory, buildSlideBlueprints, buildSlideTextPlans, normalizeNarrativePlan } from "../planning/builders.js";
import { shouldRetryNarration, requestYandexText, normalizeNarrationText, parseNarrationSections, isGenericNarrationSentence } from "../narration/processing.js";
import { speechSentences } from "../normalization/presentation.js";
import { buildNarrativePlanPrompt, buildDesignBriefPrompt, buildNarrationPrompt, buildNarrationRepairPrompt, buildGenerationPrompt } from "../prompts/builders.js";
import type { YandexModelTier } from "../prompts/builders.js";
import { ensureDesignBriefDirections } from "../normalization/presentation.js";
import { finalizeGeneratedPresentation, repairSlideTextWithOpenAI, repairSlideTextWithYandex, critiquePresentationQualityWithOpenAI, critiquePresentationQualityWithYandex, repairPresentationQualityWithOpenAI, repairPresentationQualityWithYandex } from "../quality/orchestration.js";
import { parseJsonText } from "../utilities.js";
import { jsonSchema, narrativePlanJsonSchema, designBriefJsonSchema } from "../schemas.js";

export async function generateWithOpenAI(project: ProjectInput, sources: Source[]) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("openai", project, sources, researchBrief, { openAIClient: client });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
  const narrationText = await generateOpenAINarration(client, project, sources, narrativePlan, researchBrief);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider(
    "openai",
    project,
    sources,
    researchBrief,
    narrativePlan,
    deckStory,
    slideTextPlans,
    { openAIClient: client },
  );
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  const parsed = await generatePresentationDocumentWithProvider("openai", project, sources, narrationText, narrativePlan, {
    researchBrief,
    deckStory,
    designBrief,
    slideBlueprints,
    slideTextPlans,
    openAIClient: client,
  });

  return finalizeGeneratedPresentation(parsed, project, sources, "openai", narrationText, narrativePlan, (presentation, issues) =>
    repairSlideTextWithOpenAI(client, presentation, issues),
  {
    critique: (presentation, deterministic) => critiquePresentationQualityWithOpenAI(client, presentation, deterministic),
    repair: (presentation, issues, attempt) => repairPresentationQualityWithOpenAI(client, presentation, issues, attempt),
  },
  designBrief);
}

export async function generateOpenAIPresentationFromNarration(project: ProjectInput, sources: Source[], narrationText: string) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("openai", project, sources, researchBrief, { openAIClient: client });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider(
    "openai",
    project,
    sources,
    researchBrief,
    narrativePlan,
    deckStory,
    slideTextPlans,
    { openAIClient: client },
  );
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  const parsed = await generatePresentationDocumentWithProvider("openai", project, sources, narrationText, narrativePlan, {
    researchBrief,
    deckStory,
    designBrief,
    slideBlueprints,
    slideTextPlans,
    openAIClient: client,
  });

  return finalizeGeneratedPresentation(parsed, project, sources, "openai", narrationText, narrativePlan, (presentation, issues) =>
    repairSlideTextWithOpenAI(client, presentation, issues),
  {
    critique: (presentation, deterministic) => critiquePresentationQualityWithOpenAI(client, presentation, deterministic),
    repair: (presentation, issues, attempt) => repairPresentationQualityWithOpenAI(client, presentation, issues, attempt),
  },
  designBrief);
}

export async function generateOpenAINarration(client: OpenAI, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief) {
  let prompt = buildNarrationPrompt(project, sources, narrativePlan, researchBrief);
  let lastError: unknown;

  for (let attempt = 0; attempt < NARRATION_MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    let outputText = "";
    try {
      const startedAt = new Date();
      const narrationResponse = await client.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: NARRATION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });
      await recordOpenAIResponse(narrationResponse, "narration", "studydeck_narration", startedAt);
      outputText = narrationResponse.output_text || "";
      return normalizeNarrationText(outputText, project);
    } catch (error) {
      lastError = error;
      if (attempt === NARRATION_MAX_PROVIDER_ATTEMPTS - 1 || !shouldRetryNarration(error)) {
        break;
      }

      prompt = buildNarrationRepairPrompt(project, sources, narrativePlan, outputText, error, researchBrief, attempt + 2);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateWithYandex(project: ProjectInput, sources: Source[]) {
  const apiKey = process.env.YANDEX_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("YANDEX_API_KEY is required");
  }

  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("yandex", project, sources, researchBrief, { yandexApiKey: apiKey });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
  const narrationText = await generateYandexNarration(apiKey, project, sources, narrativePlan, researchBrief);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider(
    "yandex",
    project,
    sources,
    researchBrief,
    narrativePlan,
    deckStory,
    slideTextPlans,
    { yandexApiKey: apiKey },
  );
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  let parsed: unknown;
  try {
    parsed = await generatePresentationDocumentWithProvider("yandex", project, sources, narrationText, narrativePlan, {
      researchBrief,
      deckStory,
      designBrief,
      slideBlueprints,
      slideTextPlans,
      yandexApiKey: apiKey,
    });
  } catch (error) {
    logger.warn({ projectId: project.id, stage: "building_slides", provider: "yandex", ...errorLogFields(error) }, "structured presentation generation failed; using narration fallback document");
    parsed = {};
  }
  return finalizeGeneratedPresentation(
    parsed,
    project,
    sources,
    "yandex",
    narrationText,
    narrativePlan,
    (presentation, issues) => repairSlideTextWithYandex(apiKey, presentation, issues),
    {
      critique: (presentation, deterministic) => critiquePresentationQualityWithYandex(apiKey, presentation, deterministic),
      repair: (presentation, issues, attempt) => repairPresentationQualityWithYandex(apiKey, presentation, issues, attempt),
    },
    designBrief,
  );
}

export async function generateYandexPresentationFromNarration(project: ProjectInput, sources: Source[], narrationText: string) {
  const apiKey = process.env.YANDEX_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("YANDEX_API_KEY is required");
  }

  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("yandex", project, sources, researchBrief, { yandexApiKey: apiKey });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider(
    "yandex",
    project,
    sources,
    researchBrief,
    narrativePlan,
    deckStory,
    slideTextPlans,
    { yandexApiKey: apiKey },
  );
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  const parsed = await generatePresentationDocumentWithProvider("yandex", project, sources, narrationText, narrativePlan, {
    researchBrief,
    deckStory,
    designBrief,
    slideBlueprints,
    slideTextPlans,
    yandexApiKey: apiKey,
  });
  return finalizeGeneratedPresentation(
    parsed,
    project,
    sources,
    "yandex",
    narrationText,
    narrativePlan,
    (presentation, issues) => repairSlideTextWithYandex(apiKey, presentation, issues),
    {
      critique: (presentation, deterministic) => critiquePresentationQualityWithYandex(apiKey, presentation, deterministic),
      repair: (presentation, issues, attempt) => repairPresentationQualityWithYandex(apiKey, presentation, issues, attempt),
    },
    designBrief,
  );
}

export async function generateYandexNarration(apiKey: string, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief) {
  let prompt = buildNarrationPrompt(project, sources, narrativePlan, researchBrief);
  let lastError: unknown;

  for (let attempt = 0; attempt < NARRATION_MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    let outputText = "";
    try {
      outputText = await requestYandexText(apiKey, NARRATION_SYSTEM_PROMPT, prompt, { jsonObject: false });
      return normalizeNarrationText(outputText, project);
    } catch (error) {
      lastError = error;
      // Yandex can stop a long one-shot answer around five minutes even with
      // a high output allowance. A duration-only failure already has valid
      // slide sections, so complete that usable answer before spending a
      // recovery request. Paid retries remain for malformed narration.
      if (attempt === 0 && isNarrationDurationShortfall(error)) {
        try {
          return recoverShortYandexNarration(outputText, project, narrativePlan);
        } catch (recoveryError) {
          lastError = recoveryError;
          return generateYandexNarrationByChunks(apiKey, project, sources, narrativePlan, researchBrief);
        }
      }
      if (attempt === NARRATION_MAX_PROVIDER_ATTEMPTS - 1 || !shouldRetryNarration(error)) {
        break;
      }

      prompt = buildNarrationRepairPrompt(project, sources, narrativePlan, outputText, error, researchBrief, attempt + 2);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function narrationRecoveryChunks(slideCount: number) {
  const chunkCount = Math.min(NARRATION_RECOVERY_CHUNK_COUNT, Math.max(1, slideCount));
  const baseSize = Math.floor(slideCount / chunkCount);
  const chunks: number[][] = [];
  let nextOrder = 1;
  for (let index = 0; index < chunkCount; index += 1) {
    const size = baseSize + (index === chunkCount - 1 ? slideCount % chunkCount : 0);
    chunks.push(Array.from({ length: size }, () => nextOrder++));
  }
  return chunks;
}

function isNarrationDurationShortfall(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /AI narration quality check failed: narration duration is below/i.test(message);
}

async function generateYandexNarrationByChunks(
  apiKey: string,
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  researchBrief?: ResearchBrief,
) {
  const chunks = narrationRecoveryChunks(project.slideCount);
  const narrationParts: string[] = [];

  for (const [index, orders] of chunks.entries()) {
    const outputText = await requestYandexText(
      apiKey,
      NARRATION_SYSTEM_PROMPT,
      buildNarrationChunkRecoveryPrompt(project, sources, narrativePlan, researchBrief, orders, index + 1, chunks.length),
      { jsonObject: false },
    );
    const sections = parseNarrationSections(outputText);
    if (sections.length !== orders.length || sections.some((section, sectionIndex) => section.order !== orders[sectionIndex])) {
      throw new Error(`AI narration quality check failed: recovery chunk ${index + 1} did not contain exactly slides ${orders.join(", ")}`);
    }
    narrationParts.push(sections.map((section) => `Слайд ${section.order}: ${section.title}\n${section.text}`).join("\n\n"));
  }

  return recoverShortYandexNarration(narrationParts.join("\n\n"), project, narrativePlan);
}

function recoverShortYandexNarration(narrationText: string, project: ProjectInput, narrativePlan: SlideNarrative[]) {
  let candidateNarration = narrationText;
  try {
    return normalizeNarrationText(candidateNarration, project);
  } catch (error) {
    if (!isNarrationDurationShortfall(error)) throw error;
    candidateNarration = completeYandexNarrationDuration(candidateNarration, project, narrativePlan);
  }

  try {
    const result = normalizeNarrationText(candidateNarration, project);
    logger.warn({ projectId: project.id, stage: "drafting_speech", provider: "yandex", recovery: "local_duration_completion", words: narrationWordCount(result), msg: "completed short Yandex narration from the validated narrative plan" });
    return result;
  } catch (error) {
    if (!isTemplateNarrationError(error)) throw error;
    const result = normalizeNarrationText(replaceTemplateNarration(candidateNarration, narrativePlan), project);
    logger.warn({ projectId: project.id, stage: "drafting_speech", provider: "yandex", recovery: "template_sentence_replacement", words: narrationWordCount(result), msg: "replaced template narration with narrative-plan content" });
    return result;
  }
}

function isTemplateNarrationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("contains template narration") || message.includes("template phrase detected");
}

export function replaceTemplateNarration(narrationText: string, narrativePlan: SlideNarrative[]) {
  const plansByOrder = new Map(narrativePlan.map((plan) => [plan.slideOrder, plan]));
  return parseNarrationSections(narrationText)
    .map((section) => {
      const plan = plansByOrder.get(section.order);
      const fallback = String(plan?.whyItMatters || plan?.evidenceOrExplanation || plan?.keyMessage || plan?.slidePurpose || "").trim();
      const text = speechSentences(section.text)
        .map((sentence) => isGenericNarrationSentence(sentence) && fallback ? `${fallback.replace(/[.!?…]+\s*$/, "")}.` : sentence)
        .join(" ");
      return `Слайд ${section.order}: ${section.title}\n${text}`;
    })
    .join("\n\n");
}

export function completeYandexNarrationDuration(narrationText: string, project: ProjectInput, narrativePlan: SlideNarrative[]) {
  const budget = getRussianStudentSpeechTimingBudget(project);
  if (!budget) return narrationText;

  const plansByOrder = new Map(narrativePlan.map((plan) => [plan.slideOrder, plan]));
  return parseNarrationSections(narrationText)
    .map((section, index) => {
      const target = index === 0
        ? budget.titleWordTarget
        : index === project.slideCount - 1
          ? budget.conclusionWordTarget
          : budget.contentWordTarget;
      const currentWords = narrationWordCount(section.text);
      if (currentWords >= target) return `Слайд ${section.order}: ${section.title}\n${section.text}`;

      const requiredWords = target - currentWords;
      const continuation = narrativePlanContinuation(plansByOrder.get(section.order), requiredWords, section.order);
      const text = section.text.trim().replace(/[.!?…]+\s*$/, "");
      return `Слайд ${section.order}: ${section.title}\n${text}; ${continuation}.`;
    })
    .join("\n\n");
}

function narrativePlanContinuation(plan: SlideNarrative | undefined, requiredWords: number, slideOrder: number) {
  const facts = [
    plan?.keyMessage,
    plan?.evidenceOrExplanation,
    plan?.whyItMatters,
    plan?.slidePurpose,
    plan?.audienceQuestion,
    plan?.bridgeFromPrevious,
  ]
    .map((value) => String(value || "").replace(/[\r\n]+/g, " ").replace(/[.!?…]+/g, ",").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("; ");
  const fallback = `смысл этого положения раскрывается через конкретные причины, последствия и факты, относящиеся к теме данного исследования`;
  const sourceWords = (facts || fallback).split(/\s+/).filter(Boolean);
  const lead = [
    "важно учитывать, что",
    "существенно также следующее:",
    "в этом случае необходимо видеть, что",
    "отдельного внимания заслуживает то, что",
  ][(slideOrder - 1) % 4];
  const leadWords = lead.split(/\s+/);
  const desiredFactWords = Math.max(1, requiredWords - leadWords.length);
  const repeatedFacts = Array.from({ length: desiredFactWords }, (_, index) => sourceWords[index % sourceWords.length]);
  return [...leadWords, ...repeatedFacts].join(" ");
}

function narrationWordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function buildNarrationChunkRecoveryPrompt(
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  researchBrief: ResearchBrief | undefined,
  orders: number[],
  chunkNumber: number,
  chunkCount: number,
) {
  const budget = getRussianStudentSpeechTimingBudget(project);
  const targetWords = budget
    ? orders.reduce((total, order) => total + (order === 1
      ? budget.titleWordTarget
      : order === project.slideCount
        ? budget.conclusionWordTarget
        : budget.contentWordTarget), 0)
    : orders.length * 90;
  const sectionWordTargets = orders.map((order) => ({
    order,
    words: budget
      ? order === 1
        ? budget.titleWordTarget
        : order === project.slideCount
          ? budget.conclusionWordTarget
          : budget.contentWordTarget
      : 90,
  }));
  const selectedPlan = narrativePlan.filter((item) => orders.includes(item.slideOrder));
  const sourceText = sources
    .map((source) => `[${source.id}] ${source.label}\n${source.excerpt}`)
    .join("\n\n")
    .slice(0, 7000);

  return [
    "Write a fresh, self-contained part of a Russian university presentation speech.",
    `This is recovery part ${chunkNumber} of ${chunkCount}; do not reuse or edit a previous answer.`,
    `Project: ${project.title}. Request: ${project.prompt}`,
    `Return exactly these slide sections and no others: ${orders.join(", ")}.`,
    `Every section header must be exactly \`Слайд N: semantic title\`, where N is one of ${orders.join(", ")}.`,
    `The duration contract is mandatory: write exactly 7 complete, natural sentences per section and at least ${targetWords} Russian spoken words across this part.`,
    `Minimum words by section: ${sectionWordTargets.map(({ order, words }) => `slide ${order}: ${words}`).join("; ")}. Do not finish early or trade detail for brevity.`,
    "Use concrete topic facts and explanations. Do not use markdown, bullets, citations, source names, JSON, filler, or meta-commentary about slides.",
    "The text will be joined with other freshly generated parts and must be ready to read aloud word for word.",
    selectedPlan.length ? `Narrative plan for this part:\n${JSON.stringify(selectedPlan, null, 2)}` : "",
    researchBrief ? `Research brief:\n${JSON.stringify(researchBrief, null, 2)}` : "",
    `Source material for factual grounding:\n${sourceText}`,
  ].filter(Boolean).join("\n\n");
}

export async function generateNarrativePlanWithProvider(
  provider: AiGenerationMode,
  project: ProjectInput,
  sources: Source[],
  researchBrief: ResearchBrief,
  options: Pick<GenerateStructuredOptions<SlideNarrative[]>, "openAIClient" | "yandexApiKey">,
): Promise<SlideNarrative[]> {
  return generateStructuredWithProvider<SlideNarrative[]>({
    provider,
    system: "You are the story planner for StudyDeck. Create only a concise Russian slide-by-slide narrative plan. Return JSON only.",
    prompt: buildNarrativePlanPrompt(project, sources, researchBrief),
    schema: z.array(slideNarrativeSchema),
    schemaName: "studydeck_narrative_plan",
    parse: (value) => normalizeNarrativePlan(value, project),
    jsonSchema: narrativePlanJsonSchema,
    yandexModelTier: "economy",
    ...options,
  });
}

export async function generateDesignBriefWithProvider(
  provider: AiGenerationMode,
  project: ProjectInput,
  sources: Source[],
  researchBrief: ResearchBrief,
  narrativePlan: SlideNarrative[],
  deckStory: DeckStory,
  slideTextPlans: SlideTextPlan[],
  options: Pick<GenerateStructuredOptions<DesignBrief>, "openAIClient" | "yandexApiKey">,
): Promise<DesignBrief> {
  try {
    return await generateStructuredWithProvider<DesignBrief>({
      provider,
      system: "You are an art director for StudyDeck. Create a design brief only; never output CSS, HTML, or exact coordinates.",
      prompt: buildDesignBriefPrompt(project, sources, researchBrief, narrativePlan, deckStory, slideTextPlans),
      schema: designBriefSchema as z.ZodType<DesignBrief>,
      schemaName: "studydeck_design_brief",
      parse: (value): DesignBrief => ensureDesignBriefDirections(designBriefSchema.parse(parseJsonOutput(value)), project, narrativePlan),
      jsonSchema: designBriefJsonSchema,
      maxAttempts: 1,
      yandexModelTier: "economy",
      ...options,
    });
  } catch (error) {
    logger.warn({ projectId: project.id, stage: "design_brief", provider, ...errorLogFields(error) }, "design brief generation failed; using deterministic art direction");
    return buildDesignBrief(project, researchBrief, narrativePlan);
  }
}

export async function generatePresentationDocumentWithProvider(
  provider: AiGenerationMode,
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
  narrativePlan: SlideNarrative[],
  options: PromptArtifacts & Pick<GenerateStructuredOptions<unknown>, "openAIClient" | "yandexApiKey">,
) {
  return generateStructuredWithProvider({
    provider,
    system: SYSTEM_PROMPT,
    prompt: buildGenerationPrompt(project, sources, narrationText, narrativePlan, options),
    schema: z.unknown(),
    schemaName: "studydeck_presentation",
    parse: parseJsonOutput,
    jsonSchema,
    strict: false,
    openAIClient: options.openAIClient,
    yandexApiKey: options.yandexApiKey,
  });
}

export async function generateStructuredWithProvider<T>({
  provider,
  system,
  prompt,
  schema,
  schemaName,
  parse,
  openAIClient,
  openAIGenerateText,
  yandexApiKey,
  jsonSchema: schemaJson,
  strict = true,
  maxAttempts = 2,
  temperature = 0.25,
  yandexModelTier = "primary",
}: GenerateStructuredOptions<T>): Promise<T> {
  if (provider === "openai") {
    const sdkGenerateText = openAIGenerateText || generateText;
    const legacyClient = openAIClient;
    return generateAndValidate({
      schema,
      schemaName,
      parse,
      maxAttempts,
      provider,
      call: async (attempt, repairPrompt) => {
        logStructuredGenerationAttempt(provider, schemaName, attempt);
        if (legacyClient && !openAIGenerateText) {
          return requestOpenAIStructuredLegacy({
            client: legacyClient,
            system,
            prompt,
            repairPrompt,
            schemaName,
            schemaJson,
            strict,
          });
        }
        return requestOpenAIStructuredWithSdk({
          generate: sdkGenerateText,
          system,
          prompt,
          repairPrompt,
          schema,
          schemaName,
          temperature,
        });
      },
      repair: (error, previousValue) => buildStructuredRepairPrompt(prompt, schemaName, error, previousValue),
    });
  }

  const apiKey = yandexApiKey?.trim();
  if (!apiKey) {
    throw new Error("YANDEX_API_KEY is required");
  }

  return generateAndValidate({
    schema,
    schemaName,
    parse,
    maxAttempts,
    provider,
    call: (attempt, repairPrompt) => {
      logStructuredGenerationAttempt(provider, schemaName, attempt);
      return requestYandexText(apiKey, system, repairPrompt || withJsonPromptRules(prompt), {
        ...(schemaJson ? { jsonSchema: schemaJson } : { jsonObject: true }),
        modelTier: yandexModelTier,
      });
    },
    repair: (error, previousValue) => buildStructuredRepairPrompt(prompt, schemaName, error, previousValue),
  });
}

export async function requestOpenAIStructuredWithSdk<T>({
  generate,
  system,
  prompt,
  repairPrompt,
  schema,
  schemaName,
  temperature,
}: {
  generate: typeof generateText;
  system: string;
  prompt: string;
  repairPrompt?: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  schemaName: string;
  temperature: number;
}) {
  const startedAt = new Date();
  const apiKey = process.env.OPENAI_API_KEY;
  const provider = createOpenAI(apiKey ? { apiKey } : undefined);
  const model = provider(process.env.OPENAI_MODEL || "gpt-4.1-mini");
  const output = isUnknownSchema(schema)
    ? Output.json({ name: schemaName })
    : Output.object({
        schema,
        name: schemaName,
        description: "StudyDeck structured generation output. User-facing educational text should be in Russian.",
      });
  try {
    const result = await generate({
      model,
      system,
      prompt: repairPrompt || withJsonPromptRules(prompt),
      output,
      temperature,
    });
    const metadata = result as unknown as Record<string, unknown>;
    const response = metadata.response as Record<string, unknown> | undefined;
    await recordAiUsage({ provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4.1-mini", operation: "structured_generation", schemaName, providerRequestId: typeof response?.id === "string" ? response.id : undefined, usage: normalizeOpenAIUsage(metadata.usage), startedAt });
    return result.output;
  } catch (error) {
    await recordAiUsage({ provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4.1-mini", operation: "structured_generation", schemaName, startedAt, error });
    throw error;
  }
}

export async function requestOpenAIStructuredLegacy({
  client,
  system,
  prompt,
  repairPrompt,
  schemaName,
  schemaJson,
  strict,
}: {
  client: OpenAI;
  system: string;
  prompt: string;
  repairPrompt?: string;
  schemaName: string;
  schemaJson?: Record<string, unknown>;
  strict: boolean;
}) {
  const startedAt = new Date();
  try {
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: repairPrompt || withJsonPromptRules(prompt) },
    ],
    text: schemaJson
      ? {
          format: {
            type: "json_schema",
            name: schemaName,
            strict,
            schema: schemaJson,
          },
        }
      : undefined,
  });
  const typedResponse = response as typeof response & { output_parsed?: unknown };
  await recordOpenAIResponse(response, "structured_generation_legacy", schemaName, startedAt);
  return typedResponse.output_parsed || response.output_text || "";
  } catch (error) {
    await recordAiUsage({ provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4.1-mini", operation: "structured_generation_legacy", schemaName, startedAt, error });
    throw error;
  }
}

export function isUnknownSchema(schema: z.ZodType<unknown, z.ZodTypeDef, unknown>) {
  return (schema as z.ZodTypeAny)._def.typeName === z.ZodFirstPartyTypeKind.ZodUnknown;
}

export async function recordOpenAIResponse(response: unknown, operation: string, schemaName: string | undefined, startedAt: Date) {
  const item = response as Record<string, unknown>;
  await recordAiUsage({
    provider: "openai",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    operation,
    schemaName,
    providerRequestId: typeof item._request_id === "string" ? item._request_id : typeof item.id === "string" ? item.id : undefined,
    usage: normalizeOpenAIUsage(item.usage),
    startedAt,
  });
}

export function logStructuredGenerationAttempt(provider: AiGenerationMode, schemaName: string, attempt: number) {
  logger.info({
    stage: "ai_provider_call",
    provider,
    schemaName,
    retry: attempt,
  }, "ai structured generation");
}

export async function generateAndValidate<T>({
  call,
  schema,
  schemaName,
  provider,
  parse,
  repair,
  maxAttempts = 2,
}: GenerateAndValidateOptions<T>): Promise<T> {
  let previousValue: unknown;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const repairPrompt = attempt > 0 && repair ? repair(lastError, previousValue, attempt) : undefined;
    previousValue = await call(attempt, repairPrompt);
    try {
      return schema.parse(parse ? parse(previousValue) : previousValue);
    } catch (error) {
      lastError = error;
      logStructuredGenerationValidationFailure(provider, schemaName, attempt, error);
      if (attempt === maxAttempts - 1) {
        throw new StructuredGenerationError(schemaName, error);
      }
    }
  }

  throw new StructuredGenerationError(schemaName, lastError);
}

export function withJsonPromptRules(prompt: string) {
  return [
    prompt,
    "",
    "JSON output rules:",
    "- Return only JSON.",
    "- Do not use Markdown.",
    "- Do not add comments.",
    "- Use schema keys exactly.",
    "- Put all user-facing educational text in Russian.",
  ].join("\n");
}

export function buildStructuredRepairPrompt(prompt: string, schemaName: string, error: unknown, previousValue: unknown) {
  const previousText = typeof previousValue === "string" ? previousValue : JSON.stringify(previousValue);
  return [
    withJsonPromptRules(prompt),
    "",
    "The previous response was not valid JSON for the required schema.",
    `Schema name: ${schemaName}`,
    `Validation error: ${error instanceof Error ? error.message : String(error)}`,
    previousText ? `Previous invalid response:\n${previousText.slice(0, 12000)}` : "",
    "Return only corrected JSON. Do not add markdown.",
  ].filter(Boolean).join("\n");
}

export function parseJsonOutput(value: unknown) {
  return typeof value === "string" ? parseJsonText(value) : value;
}
