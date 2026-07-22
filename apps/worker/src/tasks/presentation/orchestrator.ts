import crypto from "node:crypto";
import OpenAI from "openai";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { captureGenerationError, errorLogFields, logger } from "../../observability.js";
import { normalizeOpenAIUsage, recordAiUsage } from "../../usage-ledger.js";
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
  ensureEditableCanvas,
  presentationSchema,
  PREMIUM_PRESENTATION_THEMES,
  PREMIUM_PRESENTATION_THEME_IDS,
  SLIDE_LAYOUT_DEFINITIONS,
  deckStorySchema,
  designBriefSchema,
  generationPipelineArtifactsSchema,
  hasMeasurableValue,
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
} from "../presentation-quality.js";

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

import type { YandexCompletionResponse } from "./constants.js";
import { STUDENT_CREATION_BRIEF_LINES, NARRATION_SYSTEM_PROMPT, SYSTEM_PROMPT, QUALITY_CRITIC_SYSTEM_PROMPT, QUALITY_REPAIR_SYSTEM_PROMPT, GENERIC_NARRATION_PHRASES, GENERIC_SCREEN_TEXT_PHRASES, TEMPLATE_TEXT_PATTERNS, GENERIC_TITLES, STOP_WORDS, REMOVED_SLIDE_LAYOUTS, SLIDE_LAYOUTS, CONTENT_LAYOUT_CYCLE } from "./constants.js";
import { selectAiProviders } from "./providers/provider-selection.js";
import { generateWithOpenAI, generateOpenAIPresentationFromNarration, generateOpenAINarration, generateWithYandex, generateYandexPresentationFromNarration, generateYandexNarration, generateNarrativePlanWithProvider } from "./providers/generation.js";
import { buildResearchBrief, buildDesignBrief, buildDeckStory, buildSlideTextPlans, normalizeNarrativePlan } from "./planning/builders.js";
import { normalizeNarrationText, parseNarrationSections } from "./narration/processing.js";
import { normalizePresentation } from "./normalization/presentation.js";
import { isDemoGenerationAllowed } from "./quality/orchestration.js";
import { buildFallbackGeneratedText, demoPresentation } from "./utilities.js";

export async function generatePresentation(project: ProjectInput, sources: Source[]): Promise<PresentationDocument> {
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return provider === "openai"
        ? await generateWithOpenAI(project, sources)
        : await generateWithYandex(project, sources);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
      captureGenerationError(error, { projectId: project.id, stage: "ai_generation", provider });
      logger.warn({ projectId: project.id, stage: "ai_generation", provider, ...errorLogFields(error) }, "ai generation failed");
    }
  }

  if (isDemoGenerationAllowed()) {
    return demoPresentation(project, sources, providers.length ? "demo-fallback" : "demo");
  }

  if (!providers.length) {
    throw new Error("No configured AI provider. Set OPENAI_API_KEY or YANDEX_API_KEY with YANDEX_FOLDER_ID/YANDEX_MODEL_URI.");
  }

  throw new Error(`AI generation failed. ${errors.join(" | ")}`);
}

export async function generateNarrationDraft(project: ProjectInput, sources: Source[]) {
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      if (provider === "openai") {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const researchBrief = buildResearchBrief(project, sources);
        const narrativePlan = await generateNarrativePlanWithProvider(provider, project, sources, researchBrief, { openAIClient: client });
        const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
        const designBrief = buildDesignBrief(project, researchBrief, narrativePlan);
        const text = await generateOpenAINarration(client, project, sources, narrativePlan, researchBrief);
        const slideTextPlans = buildSlideTextPlans(project, text, narrativePlan, deckStory, sources);
        generationPipelineArtifactsSchema.parse({ researchBrief, narrativePlan, deckStory, designBrief, slideBlueprints: [], slideTextPlans });
        return { text, narrativePlan, generationMode: provider };
      }

      const apiKey = process.env.YANDEX_API_KEY?.trim();
      if (!apiKey) {
        throw new Error("YANDEX_API_KEY is required");
      }

      const researchBrief = buildResearchBrief(project, sources);
      const narrativePlan = await generateNarrativePlanWithProvider(provider, project, sources, researchBrief, { yandexApiKey: apiKey });
      const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
      const designBrief = buildDesignBrief(project, researchBrief, narrativePlan);
      const text = await generateYandexNarration(apiKey, project, sources, narrativePlan, researchBrief);
      const slideTextPlans = buildSlideTextPlans(project, text, narrativePlan, deckStory, sources);
      generationPipelineArtifactsSchema.parse({ researchBrief, narrativePlan, deckStory, designBrief, slideBlueprints: [], slideTextPlans });
      return { text, narrativePlan, generationMode: provider };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
      captureGenerationError(error, { projectId: project.id, stage: "drafting_speech", provider });
      logger.warn({ projectId: project.id, stage: "drafting_speech", provider, ...errorLogFields(error) }, "ai narration generation failed");
    }
  }

  if (isDemoGenerationAllowed()) {
    return {
      text: buildFallbackGeneratedText(project),
      narrativePlan: normalizeNarrativePlan([], project),
      generationMode: providers.length ? "demo-fallback" : "demo",
    };
  }

  if (!providers.length) {
    throw new Error("No configured AI provider. Set OPENAI_API_KEY or YANDEX_API_KEY with YANDEX_FOLDER_ID/YANDEX_MODEL_URI.");
  }

  throw new Error(`AI narration generation failed. ${errors.join(" | ")}`);
}

export async function generatePresentationFromNarration(
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
): Promise<PresentationDocument> {
  const fixedNarration = normalizeNarrationText(narrationText, project);
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return provider === "openai"
        ? await generateOpenAIPresentationFromNarration(project, sources, fixedNarration)
        : await generateYandexPresentationFromNarration(project, sources, fixedNarration);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
      captureGenerationError(error, { projectId: project.id, stage: "building_slides", provider });
      logger.warn({ projectId: project.id, stage: "building_slides", provider, ...errorLogFields(error) }, "ai presentation generation failed");
    }
  }

  // Once the speech has been accepted, it is a complete, user-approved
  // recovery checkpoint. Provider output improves the deck, but it must not
  // be a prerequisite for delivering a readable presentation. This path is
  // deliberately independent from ALLOW_DEMO_GENERATION: it preserves the
  // accepted speech rather than inventing a demo script.
  logger.warn({
    projectId: project.id,
    stage: "building_slides",
    providers,
    errors,
    recovery: "accepted_narration_safe_deck",
  }, "AI slide generation unavailable; building a local presentation from accepted narration");
  return buildSafePresentationFromNarration(project, sources, fixedNarration);
}

/**
 * Assemble a non-paid, no-network presentation from already accepted speech.
 * The normalizer derives only the slide projection and canvas; `generatedText`
 * and the corresponding speaker notes remain the accepted narration.
 */
export function buildSafePresentationFromNarration(
  project: ProjectInput,
  sources: Source[],
  acceptedNarration: string,
): PresentationDocument {
  const normalized = normalizePresentation(
    {},
    project,
    sources,
    "demo-fallback",
    acceptedNarration,
    normalizeNarrativePlan([], project),
    false,
  );
  const sections = parseNarrationSections(acceptedNarration);
  if (sections.length !== project.slideCount || sections.some((section, index) => section.order !== index + 1 || !section.text)) {
    return ensureEditableCanvas(normalized);
  }

  // `normalizePresentation` is intentionally allowed to replace malformed
  // provider text. This recovery path receives user-approved text instead,
  // so restore that canonical projection verbatim after it has built the
  // safe visible canvas.
  return ensureEditableCanvas(presentationSchema.parse({
    ...normalized,
    generatedText: acceptedNarration,
    slides: normalized.slides.map((slide, index) => ({
      ...slide,
      speakerNotes: sections[index].text,
    })),
    speechScript: normalized.slides.map((slide, index) => ({
      slideOrder: slide.order,
      slideTitle: slide.title,
      text: sections[index].text,
    })),
  }));
}
