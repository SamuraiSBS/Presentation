import crypto from "node:crypto";
import OpenAI from "openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { captureGenerationError, errorLogFields, logger } from "../../observability.js";
import { currentUsageContext, normalizeOpenAIUsage, recordAiUsage } from "../../usage-ledger.js";
import { aitunnelConfig, createAitunnelClient, createOpenAIClient } from "../../openai-client.js";
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
  sourceRefFromSource,
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

type AiGenerationMode = "openai" | "yandex" | "aitunnel" | "local";
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
import { generateWithAitunnel, generateWithOpenAI, generateAitunnelPresentationFromNarration, generateOpenAIPresentationFromNarration, generateAitunnelNarration, generateAitunnelFullNarrationOutcome, generateOpenAINarration, generateWithYandex, generateYandexPresentationFromNarration, generateYandexNarration, generateNarrativePlanWithProvider } from "./providers/generation.js";
import { buildResearchBrief, buildDesignBrief, buildDeckStory, buildSlideBlueprints, buildSlideTextPlans, normalizeNarrativePlan } from "./planning/builders.js";
import { normalizeNarrationText, parseNarrationSections } from "./narration/processing.js";
import { normalizePresentation } from "./normalization/presentation.js";
import { assertPresentationQuality, isDemoGenerationAllowed } from "./quality/orchestration.js";
import { buildFallbackGeneratedText, demoPresentation } from "./utilities.js";
import { AitunnelProjectBudget, runWithAitunnelProjectBudget } from "../../aitunnel-narration-budget.js";

export async function generatePresentation(project: ProjectInput, sources: Source[]): Promise<PresentationDocument> {
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return provider === "openai" ? await generateWithOpenAI(project, sources)
        : provider === "aitunnel" ? await generateWithAitunnel(project, sources)
          : await generateWithYandex(project, sources);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
      captureGenerationError(error, { projectId: project.id, stage: "ai_generation", provider });
      logger.warn({ projectId: project.id, stage: "ai_generation", provider, ...errorLogFields(error) }, "ai generation failed");
    }
  }

  if (isDemoGenerationAllowed() && process.env.AI_PROVIDER?.trim().toLowerCase() !== "aitunnel") {
    return demoPresentation(project, sources, providers.length ? "demo-fallback" : "demo");
  }

  if (!providers.length) {
    throw new Error("No configured AI provider. Configure OpenAI, Yandex, or AITUNNEL with an explicit model.");
  }

  throw new Error(`AI generation failed. ${errors.join(" | ")}`);
}

export async function generateNarrationDraft(project: ProjectInput, sources: Source[]) {
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      if (provider === "openai") {
        const client = createOpenAIClient();
        const researchBrief = buildResearchBrief(project, sources);
        const narrativePlan = await generateNarrativePlanWithProvider(provider, project, sources, researchBrief, { openAIClient: client });
        const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
        const designBrief = buildDesignBrief(project, researchBrief, narrativePlan);
        const text = await generateOpenAINarration(client, project, sources, narrativePlan, researchBrief);
        const slideTextPlans = buildSlideTextPlans(project, text, narrativePlan, deckStory, sources);
        generationPipelineArtifactsSchema.parse({ researchBrief, narrativePlan, deckStory, designBrief, slideBlueprints: [], slideTextPlans });
        return { text, narrativePlan, generationMode: provider };
      }

      if (provider === "aitunnel") {
        const config = aitunnelConfig();
        if (!config) throw new Error("AITUNNEL_API_KEY and an explicit AITUNNEL_NARRATION_MODEL are required");
        const client = createAitunnelClient();
        return runWithAitunnelProjectBudget(new AitunnelProjectBudget(), async () => {
          const researchBrief = buildResearchBrief(project, sources);
          const narrativePlan = await generateNarrativePlanWithProvider(provider, project, sources, researchBrief, { openAIClient: client, openAIModel: config.narrationModel });
          const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
          const designBrief = buildDesignBrief(project, researchBrief, narrativePlan);
          const narrationOutcome = currentUsageContext()?.costEnvelopePolicyVersion === "standard-generation-cost-envelope-v6"
            ? await generateAitunnelFullNarrationOutcome(client, project, sources, narrativePlan)
            : undefined;
          // An editable v6 draft is a narration-only recovery result.  It is
          // intentionally persisted before any presentation-oriented artifact
          // construction: malformed slide text plans must not discard a
          // structurally usable speech that the user can edit.
          if (narrationOutcome?.kind === "editable_draft") {
            return { text: narrationOutcome.text, narrativePlan, generationMode: provider, narrationOutcome };
          }
          const text = narrationOutcome?.text || await generateAitunnelNarration(client, config.narrationModel, project, sources, narrativePlan, researchBrief);
          const slideTextPlans = buildSlideTextPlans(project, text, narrativePlan, deckStory, sources);
          generationPipelineArtifactsSchema.parse({ researchBrief, narrativePlan, deckStory, designBrief, slideBlueprints: [], slideTextPlans });
          return { text, narrativePlan, generationMode: provider, ...(narrationOutcome ? { narrationOutcome } : {}) };
        });
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

  if (isDemoGenerationAllowed() && process.env.AI_PROVIDER?.trim().toLowerCase() !== "aitunnel") {
    return {
      text: buildFallbackGeneratedText(project),
      narrativePlan: normalizeNarrativePlan([], project),
      generationMode: providers.length ? "demo-fallback" : "demo",
    };
  }

  if (!providers.length) {
    throw new Error("No configured AI provider. Configure OpenAI, Yandex, or AITUNNEL with an explicit model.");
  }

  throw new Error(`AI narration generation failed. ${errors.join(" | ")}`);
}

/**
 * Economic presentation generation starts after narration is accepted.  This
 * projection is intentionally local: it never instantiates a provider or
 * invokes a model repair/critic path.
 */
export async function generatePresentationFromNarration(
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
): Promise<PresentationDocument> {
  return buildLocalPresentationFromAcceptedNarration(project, sources, narrationText);
}

export function buildLocalPresentationFromAcceptedNarration(
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
): PresentationDocument {
  const acceptedNarration = normalizeNarrationText(narrationText, project);
  const sections = parseNarrationSections(acceptedNarration);
  if (sections.length !== project.slideCount || sections.some((section, index) => section.order !== index + 1 || !section.text)) {
    throw new Error("Accepted narration does not contain one complete section per slide");
  }

  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = normalizeNarrativePlan(sections.map((section, index) => ({
    ...localNarrativeFields(section.text),
    slideOrder: index + 1,
    slideTitle: section.title,
    audienceQuestion: section.title,
    transitionToNext: "",
    supportedFactSourceIds: relevantSourceIds(section.text, sources),
  })), project);
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
  const designBrief = buildDesignBrief(project, researchBrief, narrativePlan);
  const slideTextPlans = buildSlideTextPlans(project, acceptedNarration, narrativePlan, deckStory, sources);
  const slideBlueprints = buildSlideBlueprints(project, acceptedNarration, narrativePlan, designBrief);
  generationPipelineArtifactsSchema.parse({ researchBrief, narrativePlan, deckStory, designBrief, slideBlueprints, slideTextPlans });

  const raw = {
    title: project.title,
    generatedText: acceptedNarration,
    narrativePlan,
    designBrief,
    slides: slideTextPlans.map((textPlan, index) => {
      const sourceIds = narrativePlan[index]?.supportedFactSourceIds || [];
      return {
        order: textPlan.slideOrder,
        slideKind: index === 0 ? "title" : index === project.slideCount - 1 ? "summary" : "content",
        title: textPlan.title,
        thesis: textPlan.thesis,
        bullets: localSectionBullets(sections[index].text, textPlan.bullets),
        speakerNotes: sections[index].text,
        sourceRefs: sourceIds
          .map((sourceId) => sources.find((source) => source.id === sourceId))
          .filter((source): source is Source => Boolean(source))
          .map(sourceRefFromSource),
      };
    }),
    speechScript: sections.map((section) => ({ slideOrder: section.order, slideTitle: section.title, text: section.text })),
  };
  const normalized = normalizePresentation(raw, project, sources, "local", acceptedNarration, narrativePlan, true, designBrief);
  const concise = presentationSchema.parse({
    ...normalized,
    slides: normalized.slides.map((slide) => ({
      ...slide,
      bullets: slide.bullets.slice(0, 3).map(shortLocalBullet),
      blocks: slide.blocks.map((block) => block.type === "bullets" ? { ...block, items: block.items.slice(0, 3).map(shortLocalBullet) } : block),
    })),
  });
  assertPresentationQuality(concise, project, "local");
  return ensureEditableCanvas({ ...concise, slides: concise.slides.map((slide) => ({ ...slide, canvas: undefined })) });
}

function localNarrativeFields(sectionText: string) {
  const sentence = sectionText.split(/(?<=[.!?])\s+/)[0]?.trim() || sectionText;
  const keyMessage = sentence.length <= 160 ? sentence : `${sentence.slice(0, 156).replace(/\s+\S*$/, "").trim()}.`;
  return { slidePurpose: keyMessage, keyMessage, evidenceOrExplanation: keyMessage, whyItMatters: keyMessage };
}

function shortLocalBullet(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  return words.length <= 5 ? value : `${words.slice(0, 4).join(" ")}.`;
}

function localSectionBullets(sectionText: string, fallback: string[]) {
  const bullets = sectionText.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).slice(1, 4).map(shortLocalBullet);
  return bullets.length >= 2 ? bullets : fallback.slice(0, 3).map(shortLocalBullet);
}

function relevantSourceIds(sectionText: string, sources: Source[]) {
  const terms = new Set(sectionText.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) || []);
  return sources.filter((source) => {
    const sourceText = `${source.label} ${source.excerpt || ""}`.toLowerCase();
    let matches = 0;
    for (const term of terms) if (sourceText.includes(term) && ++matches >= 2) return true;
    return false;
  }).map((source) => source.id);
}

// Kept for direct provider regression coverage. Production jobs use the
// local accepted-narration projection above.
export async function generatePresentationFromNarrationWithProviders(
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
): Promise<PresentationDocument> {
  const fixedNarration = normalizeNarrationText(narrationText, project);
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return provider === "openai" ? await generateOpenAIPresentationFromNarration(project, sources, fixedNarration)
        : provider === "aitunnel" ? await generateAitunnelPresentationFromNarration(project, sources, fixedNarration)
          : await generateYandexPresentationFromNarration(project, sources, fixedNarration);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
      captureGenerationError(error, { projectId: project.id, stage: "building_slides", provider });
      logger.warn({ projectId: project.id, stage: "building_slides", provider, ...errorLogFields(error) }, "ai presentation generation failed");
    }
  }

  if (!providers.length) {
    throw new Error("No configured AI provider. Configure OpenAI, Yandex, or AITUNNEL with an explicit model.");
  }

  // Accepted narration remains available for a retry, but it is not a
  // substitute for a provider-produced presentation.  The worker catches
  // this error before persistence, so no demo-fallback revision is saved.
  throw new Error(`AI slide generation failed. ${errors.join(" | ")}`);
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
