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
import { assessFullNarrationDocument, normalizeNarrationText, parseNarrationSections } from "./narration/processing.js";
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
          const narrationOutcome = ["standard-generation-cost-envelope-v6", "standard-generation-cost-envelope-v7", "standard-generation-cost-envelope-v8", "standard-generation-cost-envelope-v9", "standard-generation-cost-envelope-v10"].includes(currentUsageContext()?.costEnvelopePolicyVersion || "")
            ? await generateAitunnelFullNarrationOutcome(client, project, sources, narrativePlan)
            : undefined;
          // Every v6 outcome is narration-only. It must reach the persistence
          // boundary before presentation-oriented artifact construction: an
          // accepted speech is just as independent from slide-text planning as
          // an editable recovery draft. Slide generation consumes the saved
          // speech in its later, deterministic job.
          if (narrationOutcome) {
            return { text: narrationOutcome.text, narrativePlan, generationMode: provider, narrationOutcome };
          }
          const text = await generateAitunnelNarration(client, config.narrationModel, project, sources, narrativePlan, researchBrief);
          const slideTextPlans = buildSlideTextPlans(project, text, narrativePlan, deckStory, sources);
          generationPipelineArtifactsSchema.parse({ researchBrief, narrativePlan, deckStory, designBrief, slideBlueprints: [], slideTextPlans });
          return { text, narrativePlan, generationMode: provider };
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
 * AITunnel uses Terra for the final structured document after the narration
 * has been accepted. Other provider modes retain the local projection, which
 * keeps their established no-network post-acceptance behaviour unchanged.
 */
export async function generatePresentationFromNarration(
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
): Promise<PresentationDocument> {
  if (selectAiProviders().includes("aitunnel")) {
    return generatePresentationFromNarrationWithProviders(project, sources, narrationText);
  }
  return buildLocalPresentationFromAcceptedNarration(project, sources, narrationText);
}

export function buildLocalPresentationFromAcceptedNarration(
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
): PresentationDocument {
  // Full-document narration has its own accepted contract with soft
  // per-slide timing targets. A local presentation fallback must preserve an
  // already accepted AI draft verbatim instead of reapplying the legacy
  // 2–7-sentence / narrow-word ceiling and failing after a provider outage.
  const acceptedFullNarration = assessFullNarrationDocument(narrationText, project).isAccepted;
  const acceptedNarration = acceptedFullNarration
    ? narrationText.trim()
    : normalizeNarrationText(narrationText, project);
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
  const slideTextPlans = buildSlideTextPlans(project, acceptedNarration, narrativePlan, deckStory, sources, { acceptedFullNarration });
  const slideBlueprints = buildSlideBlueprints(project, acceptedNarration, narrativePlan, designBrief, { acceptedFullNarration });
  generationPipelineArtifactsSchema.parse({ researchBrief, narrativePlan, deckStory, designBrief, slideBlueprints, slideTextPlans });

  const raw = {
    title: project.title,
    generatedText: acceptedNarration,
    narrativePlan,
    designBrief,
    slides: slideTextPlans.map((textPlan, index) => {
      const supportedSourceIds = narrativePlan[index]?.supportedFactSourceIds || [];
      // A saved source snapshot is provenance, not an optional decoration.
      // When a narration section has no exact lexical overlap with its compact
      // excerpt, retain one real snapshot source by stable slide order rather
      // than silently dropping every reference from the local projection.
      const sourceIds = supportedSourceIds.length
        ? supportedSourceIds
        : sources[index % sources.length] ? [sources[index % sources.length]!.id] : [];
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
    // The visible title can be shortened for the canvas. Keep the paired
    // speech-script title identical to that visible title so the local
    // recovery document passes the same per-slide narration contract.
    speechScript: slideTextPlans.map((textPlan, index) => ({ slideOrder: textPlan.slideOrder, slideTitle: textPlan.title, text: sections[index]!.text })),
  };
  const normalizedBase = normalizePresentation(raw, project, sources, "local", acceptedNarration, narrativePlan, !acceptedFullNarration, designBrief);
  // `normalizePresentation` is intentionally conservative and can replace
  // unfamiliar-but-valid narration headers with a generic fallback. On this
  // path the full narration was already accepted upstream, so restore its
  // exact sections after the layout projection has been built.
  const normalized = acceptedFullNarration
    ? presentationSchema.parse({
      ...normalizedBase,
      generatedText: acceptedNarration,
      slides: normalizedBase.slides.map((slide, index) => ({ ...slide, speakerNotes: sections[index]!.text })),
      speechScript: normalizedBase.slides.map((slide, index) => ({ slideOrder: slide.order, slideTitle: slide.title, text: sections[index]!.text })),
    })
    : normalizedBase;
  const concise = presentationSchema.parse({
    ...normalized,
    slides: normalized.slides.map((slide) => ({
      ...slide,
      // Full accepted narration is already quality-checked upstream.  Keep
      // complete, distinct local support sentences; the legacy four-word
      // compactor turns valid evidence into generic fragments.
      bullets: acceptedFullNarration ? slide.bullets.slice(0, 3) : slide.bullets.slice(0, 3).map(shortLocalBullet),
      // The local projection already exposes the accepted narration through
      // its thesis and support points.  Provider-oriented callouts can carry
      // an overlong duplicate sentence, so omit optional blocks rather than
      // shortening or inventing narration after acceptance.
      blocks: slide.blocks
        .filter((block) => block.type === "bullets")
        .map((block) => ({ ...block, items: acceptedFullNarration ? block.items.slice(0, 3) : block.items.slice(0, 3).map(shortLocalBullet) })),
    })),
  });
  // An accepted full-document narration has already passed its own semantic
  // contract. Let the worker's final production gate repair the compact slide
  // projection instead of failing here through the legacy visible-text gate
  // before the emergency readable canvas can run.
  if (!acceptedFullNarration) assertPresentationQuality(concise, project, "local");
  return ensureEditableCanvas({
    ...concise,
    presentationTheme: acceptedFullNarration ? PREMIUM_PRESENTATION_THEMES.academicClean : concise.presentationTheme,
    designBrief: acceptedFullNarration ? undefined : concise.designBrief,
    slides: concise.slides.map((slide) => acceptedFullNarration
      // A summary canvas reserves a narrow conclusion slot.  The accepted
      // narration's final thesis can legitimately be longer, so retain the
      // final-slide semantic check by order while rendering it in a roomy
      // content canvas selected for the actual visible text capacity.
      ? { ...slide, slideKind: slide.order === project.slideCount ? "content" : slide.slideKind, layout: (["statement", "hero", "definition"] as const)[(slide.order - 1) % 3], bullets: [], blocks: [], visual: { type: "schema", title: slide.title, description: slide.thesis, leftLabel: "", rightLabel: "", items: slide.bullets.slice(0, 2).map((label) => ({ label: shortLocalVisualLabel(label), text: "" })), rows: [] }, canvas: undefined }
      : { ...slide, canvas: undefined }),
  });
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

function shortLocalVisualLabel(value: string) {
  const completeClause = value.split(/[,;:—]/u)
    .map((part) => part.trim())
    .find((part) => part.length >= 12 && part.length <= 96);
  if (completeClause) return completeClause;
  const words = value.split(/\s+/).filter(Boolean);
  return words.slice(0, 9).join(" ").replace(/[,:;—-]+$/u, "");
}

function localSectionBullets(sectionText: string, fallback: string[]) {
  // A local canvas cannot safely host a long support sentence.  Keep only
  // short, self-contained clauses already present in the accepted narration;
  // never manufacture a four-word fragment merely to fill a bullet slot.
  const dependentStart = /^(?:если|когда|чтобы|поскольку|так как|несмотря на|в отличие от|кроме того|для|при|после|до)\b/iu;
  const danglingEnd = /(?:\b(?:и|но|или|для|к|с|из|от|по|о|в|на)|[,:;—-])\s*$/iu;
  const candidates = sectionText
    .split(/(?<=[.!?])\s+/)
    .flatMap((sentence) => sentence.split(/[,;:—]/u).map((part) => part.trim()))
    .filter((part) => {
      const words = part.split(/\s+/).filter(Boolean);
      return words.length >= 4 && words.length <= 18 && !dependentStart.test(part) && !danglingEnd.test(part);
    });
  const bullets: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    bullets.push(candidate);
    if (bullets.length === 3) break;
  }
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
  const providers = selectAiProviders();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      // Full-document AITunnel narration is accepted against its own contract,
      // whose per-slide targets are deliberately soft. Re-normalizing it here
      // would reintroduce the retired legacy ceiling before Terra sees it.
      const providerNarration = provider === "aitunnel"
        ? narrationText
        : normalizeNarrationText(narrationText, project);
      return provider === "openai" ? await generateOpenAIPresentationFromNarration(project, sources, providerNarration)
        : provider === "aitunnel" ? await generateAitunnelPresentationFromNarration(project, sources, providerNarration)
          : await generateYandexPresentationFromNarration(project, sources, providerNarration);
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
