import crypto from "node:crypto";
import OpenAI from "openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { captureGenerationError, errorLogFields, logger } from "../../../observability.js";
import { calculateProviderCost, currentUsageContext, normalizeOpenAIUsage, recordAiUsage } from "../../../usage-ledger.js";
import { failCostEnvelope, releaseCostEnvelope, reserveCostEnvelope, reserveCostEnvelopeBatch, settleCostEnvelope } from "../../../cost-envelope.js";
import { getPrisma } from "../../../prisma.js";
import { aitunnelConfig, createAitunnelClient, createOpenAIClient, createOpenAIProvider } from "../../../openai-client.js";
import {
  aitunnelNarrationBudgetConfig,
  reserveAitunnelStageCall,
  AitunnelProjectBudget,
  aitunnelModelForStage,
  aitunnelStagePolicy,
  currentAitunnelProjectBudget,
  runWithAitunnelProjectBudget,
  type AitunnelNarrationSectionStage,
  type AitunnelStage,
} from "../../../aitunnel-narration-budget.js";
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
  russianSpeechMinutesFromWords,
  getRussianStudentSpeechTimingBudget,
  getFloorAwareSpeechTimingSectionBounds,
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
  openAIModel?: string;
  openAIGenerateText?: typeof generateText;
  yandexApiKey?: string;
  jsonSchema?: Record<string, unknown>;
  strict?: boolean;
  maxAttempts?: number;
  temperature?: number;
  yandexModelTier?: YandexModelTier;
  aitunnelStage?: AitunnelStage;
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

// Narration has one initial text call and, after any validation failure, one
// complete replacement. This is deliberately separate from BullMQ transport retries.
export const MAX_YANDEX_NARRATION_TEXT_CALLS = 2;
export const MAX_AITUNNEL_NARRATION_TEXT_CALLS = 21;
const OPENAI_NARRATION_MAX_PROVIDER_ATTEMPTS = 4;
export const PRESENTATION_RECOVERY_CHUNK_COUNT = 3;

import type { YandexCompletionResponse } from "../constants.js";
import { STUDENT_CREATION_BRIEF_LINES, NARRATION_SYSTEM_PROMPT, AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT, SYSTEM_PROMPT, QUALITY_CRITIC_SYSTEM_PROMPT, QUALITY_REPAIR_SYSTEM_PROMPT, GENERIC_NARRATION_PHRASES, GENERIC_SCREEN_TEXT_PHRASES, TEMPLATE_TEXT_PATTERNS, GENERIC_TITLES, STOP_WORDS, REMOVED_SLIDE_LAYOUTS, SLIDE_LAYOUTS, CONTENT_LAYOUT_CYCLE } from "../constants.js";
import { buildResearchBrief, buildDesignBrief, logStructuredGenerationValidationFailure, buildDeckStory, buildSlideBlueprints, buildSlideTextPlans, normalizeNarrativePlan } from "../planning/builders.js";
import { shouldRetryNarration, requestYandexText, normalizeNarrationText, parseNarrationSections, findSpokenNarrationIssues } from "../narration/processing.js";
import { speechSentences } from "../normalization/presentation.js";
import { buildNarrativePlanPrompt, buildDesignBriefPrompt, buildNarrationPrompt, buildNarrationRepairPrompt, buildFullNarrationDurationRewritePrompt, buildAitunnelFullNarrationRewritePrompt, buildAitunnelNarrationSectionPrompt, buildAitunnelNarrationSectionReplacementPrompt, buildAitunnelNarrationGlobalRewritePrompt, buildGenerationPrompt, buildYandexPresentationRecoveryPrompt, getYandexModelConfig } from "../prompts/builders.js";
import type { NarrationRewriteFailureCategory, YandexModelTier } from "../prompts/builders.js";
import { ensureDesignBriefDirections } from "../normalization/presentation.js";
import { finalizeGeneratedPresentation, repairSlideTextWithOpenAI, repairSlideTextWithYandex, critiquePresentationQualityWithOpenAI, critiquePresentationQualityWithYandex, repairPresentationQualityWithOpenAI, repairPresentationQualityWithYandex } from "../quality/orchestration.js";
import { parseJsonText } from "../utilities.js";
import { jsonSchema, narrativePlanJsonSchema, designBriefJsonSchema } from "../schemas.js";

export async function generateWithOpenAI(project: ProjectInput, sources: Source[]) {
  const client = createOpenAIClient();
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

export async function generateWithAitunnel(project: ProjectInput, sources: Source[]) {
  const config = aitunnelConfig();
  if (!config) throw new Error("AITUNNEL_API_KEY and an explicit AITUNNEL_NARRATION_MODEL are required");
  const client = createAitunnelClient();
  return runWithAitunnelProjectBudget(new AitunnelProjectBudget(), async () => {
  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("aitunnel", project, sources, researchBrief, { openAIClient: client, openAIModel: config.narrationModel });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
  const narrationText = await generateAitunnelNarration(client, config.narrationModel, project, sources, narrativePlan, researchBrief);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider("aitunnel", project, sources, researchBrief, narrativePlan, deckStory, slideTextPlans, { openAIClient: client, openAIModel: config.narrationModel });
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  const parsed = await generatePresentationDocumentWithProvider("aitunnel", project, sources, narrationText, narrativePlan, {
    researchBrief, deckStory, designBrief, slideBlueprints, slideTextPlans, openAIClient: client, openAIModel: config.narrationModel,
  });
  return finalizeGeneratedPresentation(parsed, project, sources, "aitunnel", narrationText, narrativePlan, (presentation, issues) =>
    repairSlideTextWithOpenAI(client, presentation, issues, { provider: "aitunnel", model: config.narrationModel }), {
      critique: (presentation, deterministic) => critiquePresentationQualityWithOpenAI(client, presentation, deterministic, { provider: "aitunnel", model: config.narrationModel }),
      repair: (presentation, issues, attempt) => repairPresentationQualityWithOpenAI(client, presentation, issues, attempt, { provider: "aitunnel", model: config.narrationModel }),
    }, designBrief);
  });
}

export async function generateOpenAIPresentationFromNarration(project: ProjectInput, sources: Source[], narrationText: string) {
  const client = createOpenAIClient();
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

export async function generateAitunnelPresentationFromNarration(project: ProjectInput, sources: Source[], narrationText: string) {
  const config = aitunnelConfig();
  if (!config) throw new Error("AITUNNEL_API_KEY and an explicit AITUNNEL_NARRATION_MODEL are required");
  const client = createAitunnelClient();
  return runWithAitunnelProjectBudget(new AitunnelProjectBudget(), async () => {
  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("aitunnel", project, sources, researchBrief, { openAIClient: client, openAIModel: config.narrationModel });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources);
  const designBrief = await generateDesignBriefWithProvider("aitunnel", project, sources, researchBrief, narrativePlan, deckStory, slideTextPlans, { openAIClient: client, openAIModel: config.narrationModel });
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief);
  const parsed = await generatePresentationDocumentWithProvider("aitunnel", project, sources, narrationText, narrativePlan, { researchBrief, deckStory, designBrief, slideBlueprints, slideTextPlans, openAIClient: client, openAIModel: config.narrationModel });
  return finalizeGeneratedPresentation(parsed, project, sources, "aitunnel", narrationText, narrativePlan, (presentation, issues) =>
    repairSlideTextWithOpenAI(client, presentation, issues, { provider: "aitunnel", model: config.narrationModel }), {
      critique: (presentation, deterministic) => critiquePresentationQualityWithOpenAI(client, presentation, deterministic, { provider: "aitunnel", model: config.narrationModel }),
      repair: (presentation, issues, attempt) => repairPresentationQualityWithOpenAI(client, presentation, issues, attempt, { provider: "aitunnel", model: config.narrationModel }),
    }, designBrief);
  });
}

export async function generateOpenAINarration(client: OpenAI, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief) {
  let prompt = buildNarrationPrompt(project, sources, narrativePlan, researchBrief);
  let lastError: unknown;

  for (let attempt = 0; attempt < OPENAI_NARRATION_MAX_PROVIDER_ATTEMPTS; attempt += 1) {
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
      if (attempt === OPENAI_NARRATION_MAX_PROVIDER_ATTEMPTS - 1 || !shouldRetryNarration(error)) {
        break;
      }

      prompt = buildNarrationRepairPrompt(project, sources, narrativePlan, outputText, error, researchBrief, attempt + 2);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateAitunnelNarration(client: OpenAI, model: string, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief): Promise<string> {
  if (!currentAitunnelProjectBudget()) return runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, model, project, sources, narrativePlan, researchBrief));
  const policy = aitunnelNarrationBudgetConfig();
  const parts = buildAitunnelNarrationSections(project, sources, narrativePlan);
  const reservationKeys = await reservePersistedBatchedNarrationEnvelope(project.id, parts);
  const accepted: string[] = [];
  let globalRewriteUsed = false;
  try {
    for (const part of parts) {
      const candidate = await requestAitunnelNarrationCall({
        client, project, narrativePlan, policy, narrationTextCall: part.call,
        stage: part.candidateStage, prompt: part.candidatePrompt,
        reservationKey: reservationKeys?.[part.candidateStage], section: part,
      });
      let section: string;
      let candidateAccepted = false;
      try {
        section = validateAitunnelNarrationSection(candidate.text, project, narrativePlan, part, "gemini-3.5-flash-lite", part.candidateStage);
        candidateAccepted = true;
      } catch (error) {
        if (!(error instanceof AitunnelNarrationSectionQualityError)) throw error;
        const fallback = await requestAitunnelNarrationCall({
          client, project, narrativePlan, policy, narrationTextCall: part.call,
          stage: part.fallbackStage, prompt: part.fallbackPrompt,
          reservationKey: reservationKeys?.[part.fallbackStage], section: part,
        });
        try {
          section = validateAitunnelNarrationSection(fallback.text, project, narrativePlan, part, "gemini-3.6-flash", part.fallbackStage);
        } catch (fallbackError) {
          if (!(fallbackError instanceof AitunnelNarrationSectionQualityError) || globalRewriteUsed) throw fallbackError;
          globalRewriteUsed = true;
          const global = await requestAitunnelNarrationCall({
            client, project, narrativePlan, policy, narrationTextCall: part.call,
            stage: "narration_global_rewrite", prompt: part.globalRewritePrompt(fallbackError.reason),
            reservationKey: reservationKeys?.narration_global_rewrite, section: part,
          });
          section = validateAitunnelNarrationSection(global.text, project, narrativePlan, part, "gemini-3.6-flash", "narration_global_rewrite");
        }
      }
      accepted.push(section);
      if (candidateAccepted) await releaseNarrationReservation(reservationKeys, part.fallbackStage, "fallback_not_needed");
    }
    // The canonical full-document checks run only after all ten sections pass.
    const narration = normalizeNarrationText(accepted.join("\n\n"), project, narrativePlan);
    if (!globalRewriteUsed) await releaseNarrationReservation(reservationKeys, "narration_global_rewrite", "global_rewrite_not_needed");
    return narration;
  } catch (error) {
    const releaseFailed = await releaseUnusedNarrationReservations(reservationKeys, parts, project.id);
    if (releaseFailed) throw narrationFailure("quality");
    if (error instanceof Error && /^narration_[a-z_]+_failure$/.test(error.message)) throw error;
    throw narrationFailure("quality");
  }
}

type AitunnelNarrationRequest = {
  client: OpenAI;
  project: ProjectInput;
  narrativePlan: SlideNarrative[];
  policy: ReturnType<typeof aitunnelNarrationBudgetConfig>;
  narrationTextCall: number;
  prompt: string;
  stage: AitunnelNarrationSectionStage;
  reservationKey?: string;
  section: AitunnelNarrationSection;
};

type AitunnelNarrationSection = {
  call: number;
  slideOrder: number;
  targetWords: number;
  candidateStage: AitunnelNarrationSectionStage;
  fallbackStage: AitunnelNarrationSectionStage;
  candidatePrompt: string;
  fallbackPrompt: string;
  globalRewritePrompt: (reason: AitunnelNarrationSectionQualityReason) => string;
};

type AitunnelNarrationSectionQualityReason = "headers_or_sections" | "word_range" | "sentence_count" | "spoken_quality" | "template_or_repetition";

class AitunnelNarrationSectionQualityError extends Error {
  constructor(readonly reason: AitunnelNarrationSectionQualityReason) {
    super("aitunnel_narration_section_invalid");
  }
}

async function requestAitunnelNarrationCall(input: AitunnelNarrationRequest) {
  const model = aitunnelModelForStage(input.stage);
  if (!model) throw narrationFailure("budget_exhausted");
  const request = {
    model,
    input: [{ role: "system" as const, content: AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT }, { role: "user" as const, content: input.prompt }],
    max_output_tokens: input.policy.maxOutputTokens,
    reasoning: { effort: input.policy.reasoningEffort, exclude: true },
  };
  const budget = currentAitunnelProjectBudget();
  const reservationKey = input.reservationKey;
  const reserved = reservationKey ? { status: "reserved" as const } : budget?.reserve(`narration-${input.narrationTextCall}`, input.stage, request);
  if (!reserved || reserved.status !== "reserved") {
    logAitunnelNarrationCall(input.project.id, model, input.narrationTextCall, input.stage, {
      failureCategory: "narration_budget_exhausted", budgetRub: input.policy.budgetRub,
    });
    throw narrationFailure("budget_exhausted");
  }

  let response: unknown;
  const startedAt = new Date();
  try {
    response = await input.client.responses.create(request);
    await recordOpenAIResponse(response, input.stage, "studydeck_narration", startedAt, "aitunnel", model, input.narrationTextCall, input.stage);
  } catch {
    if (reservationKey) await failCostEnvelope({ envelopeId: currentUsageContext()!.costEnvelopeId!, idempotencyKey: reservationKey, reason: "narration_provider_error" }).catch(() => undefined);
    await recordAiUsage({ provider: "aitunnel", model, operation: input.stage, schemaName: "studydeck_narration", attempt: input.narrationTextCall, stage: input.stage, startedAt, error: new Error("narration_provider_error") });
    logAitunnelNarrationCall(input.project.id, model, input.narrationTextCall, input.stage, {
      failureCategory: "provider_error", budgetRub: input.policy.budgetRub,
    });
    throw narrationFailure("provider");
  }

  const responseItem = response as { output_text?: string; usage?: unknown };
  const usage = normalizeOpenAIUsage(responseItem.usage);
  if (reservationKey) {
    const envelopeId = currentUsageContext()!.costEnvelopeId!;
    // Cost-envelope settlement requires the provider-reported cost. We only
    // have token usage here, so use the same catalog arithmetic as telemetry.
    if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) {
      await settleCostEnvelope({ envelopeId, idempotencyKey: reservationKey, reason: "usage_unavailable" });
      logAitunnelNarrationCall(input.project.id, model, input.narrationTextCall, input.stage, { failureCategory: "narration_usage_unavailable", budgetRub: input.policy.budgetRub });
      throw narrationFailure("usage_unavailable");
    }
    const priced = calculateProviderCost("aitunnel", model, startedAt, usage);
    if (priced.status !== "priced" || !priced.sourceCost) {
      await settleCostEnvelope({ envelopeId, idempotencyKey: reservationKey, reason: "price_unavailable" });
      throw narrationFailure("usage_unavailable");
    }
    const actualCostRub = priced.sourceCost;
    const settledEnvelope = await settleCostEnvelope({ envelopeId, idempotencyKey: reservationKey, actualRub: actualCostRub, reason: "usage_reported" });
    if (settledEnvelope.status !== "settled") throw narrationFailure("budget_overrun");
    return { text: responseItem.output_text || "" };
  }
  const settled = budget!.settle(`narration-${input.narrationTextCall}`, usage);
  if (settled.status === "aitunnel_usage_unavailable") {
    logAitunnelNarrationCall(input.project.id, model, input.narrationTextCall, input.stage, {
      failureCategory: "narration_usage_unavailable", budgetRub: input.policy.budgetRub,
    });
    throw narrationFailure("usage_unavailable");
  }
  if (settled.status === "aitunnel_project_budget_overrun") {
    logAitunnelNarrationCall(input.project.id, model, input.narrationTextCall, input.stage, {
      failureCategory: "narration_budget_overrun", budgetRub: input.policy.budgetRub, actualCostRub: settled.actualCostRub,
    });
    throw narrationFailure("budget_overrun");
  }
  logAitunnelNarrationCall(input.project.id, model, input.narrationTextCall, input.stage, {
    budgetRub: input.policy.budgetRub, reservationRub: settled.reservation.costRub, actualCostRub: settled.actualCostRub, remainingRub: settled.projectRemaining,
  });
  return { text: responseItem.output_text || "" };
}

async function reservePersistedBatchedNarrationEnvelope(projectId: string, parts: readonly AitunnelNarrationSection[]) {
  const envelopeId = currentUsageContext()?.costEnvelopeId;
  if (!envelopeId) return undefined as Record<AitunnelNarrationSectionStage, string> | undefined;
  const envelope = await getPrisma().costEnvelope.findUniqueOrThrow({ where: { id: envelopeId }, select: { policySnapshot: true } });
  const buckets = (envelope.policySnapshot as { buckets?: Record<string, string> }).buckets || {};
  const stagePrompts: Array<readonly [AitunnelNarrationSectionStage, string, number]> = [...parts.flatMap((part) => [
    [part.candidateStage, part.candidatePrompt, part.call] as const,
    [part.fallbackStage, part.fallbackPrompt, part.call] as const,
  ]), ...parts.map((part) => ["narration_global_rewrite" as const, part.globalRewritePrompt("spoken_quality"), part.call] as const)];
  for (const [stage, prompt, call] of stagePrompts) {
    const amountRub = String(buckets[stage] || "");
    if (!/^\d+(?:\.\d+)?$/.test(amountRub) || amountRub === "0") {
      logPersistedNarrationPreflightFailure(projectId, call, stage, "missing_policy_bucket");
      throw narrationFailure("budget_exhausted");
    }
    const worstCase = reserveAitunnelStageCall(stage, { input: [{ role: "system", content: AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT }, { role: "user", content: prompt }] });
    if (!worstCase) {
      logPersistedNarrationPreflightFailure(projectId, call, stage, "stage_budget_unavailable", amountRub);
      throw narrationFailure("budget_exhausted");
    }
    if (Number(worstCase.costRub) > Number(amountRub)) {
      logPersistedNarrationPreflightFailure(projectId, call, stage, "prompt_above_bucket", amountRub, worstCase.costRub);
      throw narrationFailure("budget_exhausted");
    }
  }
  const reservationStages = [...parts.flatMap((part) => [part.candidateStage, part.fallbackStage]), "narration_global_rewrite" as const];
  const inputs = reservationStages.map((stage) => ({ envelopeId, idempotencyKey: `${envelopeId}:${stage}`, bucket: stage, stage, amountRub: String(buckets[stage]) }));
  const result = await reserveCostEnvelopeBatch(inputs);
  if (result.status !== "reserved") {
    logPersistedNarrationPreflightFailure(projectId, 0, parts[0]!.candidateStage, "batch_blocked", undefined, undefined, result.reason);
    throw narrationFailure("budget_exhausted");
  }
  return Object.fromEntries(inputs.map((input) => [input.stage, input.idempotencyKey])) as Record<AitunnelNarrationSectionStage, string>;
}

function buildAitunnelNarrationSections(project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[]): AitunnelNarrationSection[] {
  const timing = getRussianStudentSpeechTimingBudget(project);
  if (!timing || project.slideCount !== 10 || narrativePlan.length !== 10) throw narrationFailure("quality");
  return narrativePlan.map((narrative, index) => {
    const slideOrder = index + 1;
    if (narrative.slideOrder !== slideOrder) throw narrationFailure("quality");
    const targetWords = slideOrder === 1 ? timing.titleWordTarget : slideOrder === project.slideCount ? timing.conclusionWordTarget : timing.contentWordTarget;
    return {
      call: slideOrder,
      slideOrder,
      targetWords,
      candidateStage: `narration_section_${slideOrder}_candidate` as AitunnelNarrationSectionStage,
      fallbackStage: `narration_section_${slideOrder}_fallback` as AitunnelNarrationSectionStage,
      candidatePrompt: buildAitunnelNarrationSectionPrompt(project, sources, narrative),
      fallbackPrompt: buildAitunnelNarrationSectionReplacementPrompt(project, sources, narrative, "narration_quality"),
      globalRewritePrompt: (reason) => buildAitunnelNarrationGlobalRewritePrompt(project, sources, narrative, reason === "word_range" ? "duration" : "narration_quality"),
    };
  });
}

function validateAitunnelNarrationSection(text: string, project: ProjectInput, narrativePlan: SlideNarrative[], part: AitunnelNarrationSection, model: string, stage: AitunnelNarrationSectionStage) {
  const sections = parseNarrationSections(text);
  const section = sections[0];
  const words = section?.text.split(/\s+/).filter(Boolean).length || 0;
  const sentences = section ? speechSentences(section.text).length : 0;
  const plan = narrativePlan.filter((item) => item.slideOrder === part.slideOrder);
  const spokenIssues = findSpokenNarrationIssues(sections, plan);
  const bounds = getRussianStudentSpeechTimingBudget(project) && getFloorAwareSpeechTimingSectionBounds(getRussianStudentSpeechTimingBudget(project)!, part.slideOrder);
  const qualityReason = sections.length !== 1 || !section || section.order !== part.slideOrder || !section.title
    ? "headers_or_sections"
    : !bounds || words < bounds.minWords || words > bounds.maxWords
      ? "word_range"
      : sentences < 2 || sentences > 7
        ? "sentence_count"
        : spokenIssues.length
          ? spokenIssues.some((issue) => issue.code === "repeated_sentence" || issue.code === "repeated_fact")
            ? "template_or_repetition"
            : "spoken_quality"
          : undefined;
  if (qualityReason) {
    logAitunnelNarrationCall(project.id, model, part.call, stage, {
      failureCategory: "quality",
      qualityReason,
      ...(qualityReason === "word_range" && bounds ? {
        wordCount: words,
        effectiveMinWords: bounds.minWords,
        effectiveMaxWords: bounds.maxWords,
      } : {}),
    });
    throw new AitunnelNarrationSectionQualityError(qualityReason);
  }
  logAitunnelNarrationCall(project.id, model, part.call, stage, { words });
  return sections.map((section) => `Слайд ${section.order}: ${section.title}\n${section.text}`).join("\n\n");
}

export function classifyAitunnelNarrationRewriteFailure(error: unknown): NarrationRewriteFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("duration") || message.includes("words")) return "duration";
  if (message.includes("missing narration section") || message.includes("expected") && (message.includes("narration sections") || message.includes("slide")) || message.includes("header") || message.includes("has no title")) return "headers_or_sections";
  if (message.includes("narrative-plan field") || message.includes("plan_echo") || message.includes("planning_formula") || message.includes("semicolon_run")) return "spoken_quality";
  if (message.includes("template") || message.includes("repeat")) return "template_or_repetition";
  return "narration_quality";
}

async function releaseNarrationReservation(keys: Record<AitunnelNarrationSectionStage, string> | undefined, stage: AitunnelNarrationSectionStage, reason: string) {
  const envelopeId = currentUsageContext()?.costEnvelopeId;
  if (!keys || !envelopeId) return;
  await releaseCostEnvelope({ envelopeId, idempotencyKey: keys[stage], reason });
}

async function releaseUnusedNarrationReservations(keys: Record<AitunnelNarrationSectionStage, string> | undefined, parts: readonly AitunnelNarrationSection[], projectId: string) {
  let releaseFailed = false;
  // Each release locks the same persisted envelope. Run them in order so a
  // terminal narration failure does not create competing serializable writes.
  for (const part of parts) {
    for (const stage of [part.candidateStage, part.fallbackStage]) {
      try {
        await releaseNarrationReservation(keys, stage, "narration_stopped_before_call");
      } catch {
        releaseFailed = true;
        logger.warn({ projectId, stage: "drafting_speech", narrationStage: stage, failureCategory: "reservation_release_failure", releaseReason: "narration_stopped_before_call" }, "AITUNNEL narration reservation release failed");
      }
    }
  }
  try {
    await releaseNarrationReservation(keys, "narration_global_rewrite", "narration_stopped_before_call");
  } catch {
    releaseFailed = true;
    logger.warn({ projectId, stage: "drafting_speech", narrationStage: "narration_global_rewrite", failureCategory: "reservation_release_failure", releaseReason: "narration_stopped_before_call" }, "AITUNNEL narration reservation release failed");
  }
  return releaseFailed;
}

function logAitunnelNarrationCall(projectId: string, model: string, narrationTextCall: number, narrationStage: AitunnelNarrationSectionStage, extra: {
  words?: number;
  wordCount?: number;
  effectiveMinWords?: number;
  effectiveMaxWords?: number;
  failureCategory?: "provider_error" | "quality" | "narration_budget_exhausted" | "narration_budget_overrun" | "narration_usage_unavailable";
  budgetRub?: string;
  reservationRub?: string;
  estimatedRub?: string;
  actualCostRub?: string;
  remainingRub?: string;
  qualityReason?: AitunnelNarrationSectionQualityReason;
  preflightReason?: "missing_policy_bucket" | "stage_budget_unavailable" | "prompt_above_bucket" | "batch_blocked";
  batchReason?: string;
}) {
  const durationMinutes = extra.words === undefined ? undefined : Number(russianSpeechMinutesFromWords(extra.words).toFixed(1));
  logger.info({ projectId, stage: "drafting_speech", narrationStage, provider: "aitunnel", model, narrationTextCall, maxNarrationTextCalls: MAX_AITUNNEL_NARRATION_TEXT_CALLS, ...extra, durationMinutes }, "AITUNNEL narration text call completed");
}

function logPersistedNarrationPreflightFailure(
  projectId: string,
  narrationTextCall: number,
  narrationStage: AitunnelNarrationSectionStage,
  preflightReason: "missing_policy_bucket" | "stage_budget_unavailable" | "prompt_above_bucket" | "batch_blocked",
  reservationRub?: string,
  estimatedRub?: string,
  batchReason?: string,
) {
  logAitunnelNarrationCall(projectId, aitunnelModelForStage(narrationStage) || "unavailable", narrationTextCall, narrationStage, {
    failureCategory: "narration_budget_exhausted",
    preflightReason,
    reservationRub,
    estimatedRub,
    batchReason,
  });
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
  const parsed = await generateYandexPresentationDocumentWithRecovery(project, sources, narrationText, narrativePlan, apiKey, {
    researchBrief, deckStory, designBrief, slideBlueprints, slideTextPlans,
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
  const parsed = await generateYandexPresentationDocumentWithRecovery(project, sources, narrationText, narrativePlan, apiKey, {
    researchBrief, deckStory, designBrief, slideBlueprints, slideTextPlans,
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

function assertCompleteStructuredPresentation(parsed: unknown, project: ProjectInput, requireExactOrders = false) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("structured presentation response is not an object");
  }
  const slides = (parsed as { slides?: unknown }).slides;
  if (!Array.isArray(slides) || slides.length !== project.slideCount) {
    throw new Error(`structured presentation response must contain ${project.slideCount} slides`);
  }
  const orders = slides.map((slide) => typeof slide === "object" && slide ? (slide as { order?: unknown }).order : undefined);
  if (requireExactOrders && orders.some((order, index) => order !== index + 1)) {
    throw new Error("structured presentation response must contain slides in exact requested order");
  }
}

export function presentationRecoveryChunks(slideCount: number) {
  const chunkCount = Math.min(PRESENTATION_RECOVERY_CHUNK_COUNT, Math.max(1, slideCount));
  const baseSize = Math.floor(slideCount / chunkCount);
  const chunks: number[][] = [];
  let nextOrder = 1;
  for (let index = 0; index < chunkCount; index += 1) {
    const size = baseSize + (index === chunkCount - 1 ? slideCount % chunkCount : 0);
    chunks.push(Array.from({ length: size }, () => nextOrder++));
  }
  return chunks;
}

export function isRecoverableYandexStructuredPresentationError(error: unknown) {
  if (error instanceof StructuredGenerationError && error.schemaName === "studydeck_presentation") {
    return isRecoverableStructuredPresentationDetail(error.validationError);
  }
  return isRecoverableStructuredPresentationDetail(error);
}

function isRecoverableStructuredPresentationDetail(error: unknown) {
  if (error instanceof SyntaxError) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /unexpected end of json input|unterminated string|unexpected token.*json|structured presentation response (is not an object|must contain|in exact requested order)|zoderror|invalid_type|validation/i.test(message);
}

async function generateYandexPresentationDocumentWithRecovery(
  project: ProjectInput,
  sources: Source[],
  narrationText: string,
  narrativePlan: SlideNarrative[],
  apiKey: string,
  artifacts: PromptArtifacts,
) {
  try {
    const parsed = await generatePresentationDocumentWithProvider("yandex", project, sources, narrationText, narrativePlan, { ...artifacts, yandexApiKey: apiKey });
    assertCompleteStructuredPresentation(parsed, project);
    return parsed;
  } catch (error) {
    if (!isRecoverableYandexStructuredPresentationError(error)) throw error;
    logger.warn({ projectId: project.id, stage: "building_slides", provider: "yandex", recovery: "chunked_structured_json", ...errorLogFields(error) }, "recovering incomplete Yandex structured presentation with bounded chunks");
  }

  const chunks = presentationRecoveryChunks(project.slideCount);
  const recoveredSlides: unknown[] = [];
  for (const [index, orders] of chunks.entries()) {
    const outputText = await requestYandexText(apiKey, SYSTEM_PROMPT, buildYandexPresentationRecoveryPrompt(project, sources, narrationText, narrativePlan, artifacts, orders, index + 1, chunks.length), {
      jsonObject: true, modelTier: "primary", maxTokens: 4200,
    });
    const parsed = parseJsonText(outputText);
    const slides = parsed && typeof parsed === "object" ? (parsed as { slides?: unknown }).slides : undefined;
    if (!Array.isArray(slides) || slides.length !== orders.length) {
      throw new Error(`Yandex structured presentation recovery chunk ${index + 1} did not contain exactly requested slides`);
    }
    const returnedOrders = slides.map((slide) => typeof slide === "object" && slide ? (slide as { order?: unknown }).order : undefined);
    if (returnedOrders.some((order, slideIndex) => order !== orders[slideIndex])) {
      throw new Error(`Yandex structured presentation recovery chunk ${index + 1} returned missing, extra, duplicate, or out-of-order slides`);
    }
    recoveredSlides.push(...slides);
  }
  const recovered = { slides: recoveredSlides };
  assertCompleteStructuredPresentation(recovered, project, true);
  return recovered;
}

export async function generateYandexNarration(apiKey: string, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief) {
  let initialText = "";
  try {
    initialText = await requestYandexText(apiKey, NARRATION_SYSTEM_PROMPT, buildNarrationPrompt(project, sources, narrativePlan, researchBrief), { jsonObject: false, modelTier: "narration", narrationTextCall: 1, maxNarrationTextCalls: MAX_YANDEX_NARRATION_TEXT_CALLS });
  } catch (error) {
    logNarrationCall(project.id, 1, "none", { failureCategory: "provider_error" });
    throw narrationFailure("provider");
  }

  try {
    return validateYandexNarration(initialText, project, narrativePlan, 1, "none");
  } catch (error) {
    return rewriteInvalidYandexNarration(apiKey, project, sources, narrativePlan, researchBrief, initialText, error);
  }
}

async function rewriteInvalidYandexNarration(
  apiKey: string,
  project: ProjectInput,
  sources: Source[],
  narrativePlan: SlideNarrative[],
  researchBrief: ResearchBrief | undefined,
  previousText: string,
  error: unknown,
) {
  let rewritten = "";
  try {
    rewritten = await requestYandexText(
      apiKey,
      NARRATION_SYSTEM_PROMPT,
      buildFullNarrationDurationRewritePrompt(project, sources, narrativePlan, previousText, error, researchBrief),
      { jsonObject: false, modelTier: "narration", narrationTextCall: 2, maxNarrationTextCalls: MAX_YANDEX_NARRATION_TEXT_CALLS },
    );
  } catch (rewriteError) {
    logNarrationCall(project.id, 2, "full_narration_rewrite", { failureCategory: "provider_error" });
    throw narrationFailure("provider");
  }
  try {
    return validateYandexNarration(rewritten, project, narrativePlan, 2, "full_narration_rewrite");
  } catch {
    throw narrationFailure("quality");
  }
}

function narrationFailure(category: "provider" | "quality" | "budget_exhausted" | "budget_overrun" | "usage_unavailable") {
  const error = new Error(`narration_${category}_failure`);
  error.name = "NarrationGenerationFailure";
  return error;
}

function validateYandexNarration(text: string, project: ProjectInput, narrativePlan: SlideNarrative[], narrationTextCall: 1 | 2, recovery: "none" | "full_narration_rewrite") {
  const spokenIssues = findSpokenNarrationIssues(parseNarrationSections(text), narrativePlan);
  if (spokenIssues.length) {
    const error = new Error(`AI narration quality check failed: ${spokenIssues.map((issue) => issue.message).join("; ")}`);
    logNarrationCall(project.id, narrationTextCall, recovery, { failureCategory: "quality" });
    throw error;
  }
  try {
    const accepted = normalizeNarrationText(text, project, narrativePlan);
    logNarrationCall(project.id, narrationTextCall, recovery, { words: narrationWordCount(accepted) });
    return accepted;
  } catch (error) {
    logNarrationCall(project.id, narrationTextCall, recovery, { failureCategory: "quality" });
    throw error;
  }
}

function logNarrationCall(projectId: string, narrationTextCall: 1 | 2, recovery: "none" | "full_narration_rewrite", extra: { words?: number; failureCategory?: "provider_error" | "quality" }) {
  const durationMinutes = extra.words === undefined ? undefined : Number(russianSpeechMinutesFromWords(extra.words).toFixed(1));
  logger.info({ projectId, stage: "drafting_speech", provider: "yandex", model: getYandexModelConfig("narration").model, narrationTextCall, maxNarrationTextCalls: MAX_YANDEX_NARRATION_TEXT_CALLS, recovery, ...extra, durationMinutes }, "Yandex narration text call completed");
}

function narrationWordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

export async function generateNarrativePlanWithProvider(
  provider: AiGenerationMode,
  project: ProjectInput,
  sources: Source[],
  researchBrief: ResearchBrief,
  options: Pick<GenerateStructuredOptions<SlideNarrative[]>, "openAIClient" | "openAIModel" | "yandexApiKey">,
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
    aitunnelStage: "narrative_plan",
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
  options: Pick<GenerateStructuredOptions<DesignBrief>, "openAIClient" | "openAIModel" | "yandexApiKey">,
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
      aitunnelStage: "design_brief",
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
  options: PromptArtifacts & Pick<GenerateStructuredOptions<unknown>, "openAIClient" | "openAIModel" | "yandexApiKey">,
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
    openAIModel: options.openAIModel,
    yandexApiKey: options.yandexApiKey,
    aitunnelStage: "presentation",
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
  openAIModel,
  openAIGenerateText,
  yandexApiKey,
  jsonSchema: schemaJson,
  strict = true,
  maxAttempts = 2,
  temperature = 0.25,
  yandexModelTier = "primary",
  aitunnelStage,
}: GenerateStructuredOptions<T>): Promise<T> {
  if (provider === "openai" || provider === "aitunnel") {
    const sdkGenerateText = openAIGenerateText || generateText;
    const legacyClient = openAIClient;
    return generateAndValidate({
      schema,
      schemaName,
      parse,
      maxAttempts: provider === "aitunnel" ? 1 : maxAttempts,
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
            provider,
            model: provider === "aitunnel" ? aitunnelModelForStage(aitunnelStage || "presentation") || "" : openAIModel || process.env.OPENAI_MODEL || "gpt-4.1-mini",
            aitunnelStage,
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
  const provider = createOpenAIProvider();
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
  provider = "openai",
  model = process.env.OPENAI_MODEL || "gpt-4.1-mini",
  aitunnelStage,
}: {
  client: OpenAI;
  system: string;
  prompt: string;
  repairPrompt?: string;
  schemaName: string;
  schemaJson?: Record<string, unknown>;
  strict: boolean;
  provider?: "openai" | "aitunnel";
  model?: string;
  aitunnelStage?: AitunnelStage;
}) {
  const startedAt = new Date();
  let persistedReservation: { envelopeId: string; idempotencyKey: string } | undefined;
  let responseUsageRecorded = false;
  try {
  const aitunnelPolicy = provider === "aitunnel" ? aitunnelStagePolicy(aitunnelStage || "presentation") : undefined;
  const request = {
    model: aitunnelPolicy?.model || model,
    input: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: repairPrompt || withJsonPromptRules(prompt) },
    ],
    text: schemaJson
      ? {
          format: {
            type: "json_schema" as const,
            name: schemaName,
            strict,
            schema: schemaJson,
          },
        }
      : undefined,
    ...(aitunnelPolicy ? { max_output_tokens: aitunnelPolicy.maxOutputTokens, reasoning: { effort: aitunnelPolicy.reasoningEffort, exclude: true } } : {}),
  };
    const budget = provider === "aitunnel" ? currentAitunnelProjectBudget() : undefined;
    const reservationKey = provider === "aitunnel" ? `${aitunnelStage || "presentation"}-${startedAt.getTime()}` : undefined;
    const reserved = budget && reservationKey ? budget.reserve(reservationKey, aitunnelStage || "presentation", request) : undefined;
    if (provider === "aitunnel" && (!reserved || reserved.status !== "reserved")) {
      throw new Error(reserved?.status || "aitunnel_project_budget_exhausted_preflight");
    }
    persistedReservation = await reservePersistedNarrativePlanEnvelope(provider, aitunnelStage);
    let response: Awaited<ReturnType<typeof client.responses.create>>;
    try {
      response = await client.responses.create(request);
    } catch (error) {
      if (persistedReservation) {
        await failCostEnvelope({ ...persistedReservation, reason: "narrative_plan_provider_error" }).catch(() => undefined);
      }
      throw error;
    }
    const usage = normalizeOpenAIUsage((response as { usage?: unknown }).usage);
    await recordOpenAIResponse(response, "structured_generation_legacy", schemaName, startedAt, provider, model, undefined, aitunnelStage);
    responseUsageRecorded = true;
    if (persistedReservation) {
      if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) {
        await settleCostEnvelope({ ...persistedReservation, reason: "narrative_plan_usage_unavailable" });
        throw new Error("aitunnel_narrative_plan_usage_unavailable");
      }
      const priced = calculateProviderCost("aitunnel", model, startedAt, usage);
      if (priced.status !== "priced" || !priced.sourceCost) {
        await settleCostEnvelope({ ...persistedReservation, reason: "narrative_plan_price_unavailable" });
        throw new Error("aitunnel_narrative_plan_price_unavailable");
      }
      const settledEnvelope = await settleCostEnvelope({ ...persistedReservation, actualRub: priced.sourceCost, reason: "usage_reported" });
      if (settledEnvelope.status !== "settled") throw new Error(`aitunnel_narrative_plan_${settledEnvelope.status}`);
    }
    if (budget && reservationKey) {
      const settled = budget.settle(reservationKey, usage);
      if (settled.status !== "settled") throw new Error(settled.status);
    }
    const typedResponse = response as typeof response & { output_parsed?: unknown };
    return typedResponse.output_parsed || response.output_text || "";
  } catch (error) {
    if (persistedReservation) {
      await failCostEnvelope({ ...persistedReservation, reason: "narrative_plan_provider_error" }).catch(() => undefined);
    }
    if (!responseUsageRecorded) {
      await recordAiUsage({ provider, model, operation: "structured_generation_legacy", schemaName, startedAt, error });
    }
    throw error;
  }
}

async function reservePersistedNarrativePlanEnvelope(provider: "openai" | "aitunnel", stage: AitunnelStage | undefined) {
  const envelopeId = provider === "aitunnel" && stage === "narrative_plan" ? currentUsageContext()?.costEnvelopeId : undefined;
  if (!envelopeId) return undefined;
  const envelope = await getPrisma().costEnvelope.findUniqueOrThrow({ where: { id: envelopeId }, select: { policySnapshot: true } });
  const amountRub = String((envelope.policySnapshot as { buckets?: Record<string, string> }).buckets?.narrative_plan || "");
  if (!/^\d+(?:\.\d+)?$/.test(amountRub) || amountRub === "0") throw new Error("aitunnel_narrative_plan_missing_policy_bucket");
  const idempotencyKey = `${envelopeId}:narrative_plan`;
  const reservation = await reserveCostEnvelope({ envelopeId, idempotencyKey, bucket: "narrative_plan", stage: "narrative_plan", amountRub });
  if (reservation.status !== "reserved") throw new Error(`aitunnel_narrative_plan_${reservation.reason || "reservation_blocked"}`);
  return { envelopeId, idempotencyKey };
}

export function isUnknownSchema(schema: z.ZodType<unknown, z.ZodTypeDef, unknown>) {
  return (schema as z.ZodTypeAny)._def.typeName === z.ZodFirstPartyTypeKind.ZodUnknown;
}

export async function recordOpenAIResponse(response: unknown, operation: string, schemaName: string | undefined, startedAt: Date, provider: "openai" | "aitunnel" = "openai", model = process.env.OPENAI_MODEL || "gpt-4.1-mini", attempt?: number, stage?: string) {
  const item = response as Record<string, unknown>;
  await recordAiUsage({
    provider,
    model,
    operation,
    schemaName,
    providerRequestId: typeof item._request_id === "string" ? item._request_id : typeof item.id === "string" ? item.id : undefined,
    usage: normalizeOpenAIUsage(item.usage),
    startedAt,
    attempt,
    stage,
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
