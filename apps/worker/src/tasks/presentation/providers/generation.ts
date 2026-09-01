import {
    designBriefSchema,
    getFloorAwareSpeechTimingSectionBounds,
    getRussianStudentSpeechTimingBudget,
    russianSpeechMinutesFromWords,
    slideNarrativeSchema,
    type CostEnvelopeBucket,
    type DeckStory,
    type DesignBrief,
    type GenerationPipelineArtifacts,
    type ResearchBrief,
    type SlideNarrative,
    type SlideTextPlan,
    type Source
} from "@studydeck/shared";
import { Output, generateText } from "ai";
import OpenAI from "openai";
import { z } from "zod";
import {
    AitunnelProjectBudget,
    aitunnelModelForStage,
    aitunnelNarrationBudgetConfig,
    aitunnelStagePolicy,
    currentAitunnelProjectBudget,
    reserveAitunnelStageCall,
    runWithAitunnelProjectBudget,
    type AitunnelNarrationSectionStage,
    type AitunnelStage,
} from "../../../aitunnel-narration-budget.js";
import { failCostEnvelope, releaseCostEnvelope, reserveCostEnvelope, reserveCostEnvelopeBatch, settleCostEnvelope } from "../../../cost-envelope.js";
import { errorLogFields, logger } from "../../../observability.js";
import { AITUNNEL_DEFAULT_NARRATION_MODEL, aitunnelConfig, createAitunnelClient, createOpenAIClient, createOpenAIProvider } from "../../../openai-client.js";
import { getPrisma } from "../../../prisma.js";
import { calculateProviderCost, currentUsageContext, normalizeOpenAIUsage, recordAiUsage } from "../../../usage-ledger.js";

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

type PromptArtifacts = Partial<Pick<GenerationPipelineArtifacts, "researchBrief" | "deckStory" | "designBrief" | "slideBlueprints" | "slideTextPlans">>;

// Narration has one initial text call and, after any validation failure, one
// complete replacement. This is deliberately separate from BullMQ transport retries.
export const MAX_YANDEX_NARRATION_TEXT_CALLS = 2;
// v6 has one complete draft, one complete rewrite, and one bounded repair.
// Historical v5 envelope snapshots retain their old section route below.
export const MAX_AITUNNEL_NARRATION_TEXT_CALLS = 3;
const OPENAI_NARRATION_MAX_PROVIDER_ATTEMPTS = 4;
export const PRESENTATION_RECOVERY_CHUNK_COUNT = 3;

import { AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT, NARRATION_SYSTEM_PROMPT, SYSTEM_PROMPT } from "../constants.js";
import { assessFullNarrationDocument, findSpokenNarrationIssues, isFullNarrationTargetedRepairEligible, normalizeNarrationText, parseNarrationSections, requestYandexText, selectBestFullNarrationAttempt, shouldRetryNarration, type FullNarrationAttempt, type FullNarrationSafeDiagnostics, type NarrationGenerationOutcome } from "../narration/processing.js";
import { ensureDesignBriefDirections, speechSentences } from "../normalization/presentation.js";
import { buildDeckStory, buildDesignBrief, buildResearchBrief, buildSlideBlueprints, buildSlideTextPlans, logStructuredGenerationValidationFailure, normalizeNarrativePlan } from "../planning/builders.js";
import type { NarrationRewriteFailureCategory, YandexModelTier } from "../prompts/builders.js";
import { aitunnelTargetedNarrationRepairResponseSchema, buildAitunnelFullNarrationCandidatePrompt, buildAitunnelFullNarrationRewriteWithDraftPrompt, buildAitunnelNarrationGlobalRewritePrompt, buildAitunnelNarrationSectionPrompt, buildAitunnelNarrationSectionReplacementPrompt, buildAitunnelTargetedNarrationRepairPrompt, buildDesignBriefPrompt, buildFullNarrationDurationRewritePrompt, buildGenerationPrompt, buildNarrationPrompt, buildNarrationRepairPrompt, buildNarrativePlanPrompt, buildYandexPresentationRecoveryPrompt, getYandexModelConfig } from "../prompts/builders.js";
import { critiquePresentationQualityWithOpenAI, critiquePresentationQualityWithYandex, finalizeGeneratedPresentation, repairPresentationQualityWithOpenAI, repairPresentationQualityWithYandex, repairSlideTextWithOpenAI, repairSlideTextWithYandex } from "../quality/orchestration.js";
import { designBriefJsonSchema, jsonSchema, narrativePlanJsonSchema } from "../schemas.js";
import { parseJsonText } from "../utilities.js";

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
  if (!config) throw new Error(`AITUNNEL_API_KEY and AITUNNEL_NARRATION_MODEL=${AITUNNEL_DEFAULT_NARRATION_MODEL} are required`);
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
    repairSlideTextWithOpenAI(client, presentation, issues, { provider: "aitunnel", model: aitunnelModelForStage("slide_text_repair")! }), {
      critique: (presentation, deterministic) => critiquePresentationQualityWithOpenAI(client, presentation, deterministic, { provider: "aitunnel", model: aitunnelModelForStage("quality_critique")! }),
      repair: (presentation, issues, attempt) => repairPresentationQualityWithOpenAI(client, presentation, issues, attempt, { provider: "aitunnel", model: aitunnelModelForStage("quality_repair")! }),
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
  if (!config) throw new Error(`AITUNNEL_API_KEY and AITUNNEL_NARRATION_MODEL=${AITUNNEL_DEFAULT_NARRATION_MODEL} are required`);
  const client = createAitunnelClient();
  return runWithAitunnelProjectBudget(new AitunnelProjectBudget(), async () => {
  const researchBrief = buildResearchBrief(project, sources);
  const narrativePlan = await generateNarrativePlanWithProvider("aitunnel", project, sources, researchBrief, { openAIClient: client, openAIModel: config.narrationModel });
  const deckStory = buildDeckStory(project, researchBrief, narrativePlan, sources);
  const slideTextPlans = buildSlideTextPlans(project, narrationText, narrativePlan, deckStory, sources, { acceptedFullNarration: true });
  const designBrief = await generateDesignBriefWithProvider("aitunnel", project, sources, researchBrief, narrativePlan, deckStory, slideTextPlans, { openAIClient: client, openAIModel: config.narrationModel });
  const slideBlueprints = buildSlideBlueprints(project, narrationText, narrativePlan, designBrief, { acceptedFullNarration: true });
  const parsed = await generatePresentationDocumentWithProvider("aitunnel", project, sources, narrationText, narrativePlan, { researchBrief, deckStory, designBrief, slideBlueprints, slideTextPlans, openAIClient: client, openAIModel: config.narrationModel });
  return finalizeGeneratedPresentation(parsed, project, sources, "aitunnel", narrationText, narrativePlan, (presentation, issues) =>
    repairSlideTextWithOpenAI(client, presentation, issues, { provider: "aitunnel", model: aitunnelModelForStage("slide_text_repair")! }), {
      critique: (presentation, deterministic) => critiquePresentationQualityWithOpenAI(client, presentation, deterministic, { provider: "aitunnel", model: aitunnelModelForStage("quality_critique")! }),
      repair: (presentation, issues, attempt) => repairPresentationQualityWithOpenAI(client, presentation, issues, attempt, { provider: "aitunnel", model: aitunnelModelForStage("quality_repair")! }),
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
  if (isFullNarrationCostEnvelopePolicy(currentUsageContext()?.costEnvelopePolicyVersion)) {
    return (await generateAitunnelFullNarrationOutcome(client, project, sources, narrativePlan)).text;
  }
  return generateLegacyAitunnelNarration(client, model, project, sources, narrativePlan, researchBrief);
}

/**
 * The v6 path deliberately keeps drafts only in memory until the terminal
 * decision.  Its caller is responsible for persisting the selected outcome.
 */
export async function generateAitunnelFullNarrationOutcome(client: OpenAI, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[]): Promise<NarrationGenerationOutcome> {
  if (!currentAitunnelProjectBudget()) return runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelFullNarrationOutcome(client, project, sources, narrativePlan));
  const candidatePrompt = buildAitunnelFullNarrationCandidatePrompt(project, sources, narrativePlan);
  const maximumDraft = maximumFullNarrationDraft(project);
  const maximumDiagnostics = assessFullNarrationDocument(maximumDraft, project, narrativePlan);
  const rewritePrompt = buildAitunnelFullNarrationRewriteWithDraftPrompt(project, sources, narrativePlan, maximumDraft, maximumDiagnostics);
  const repairPrompt = buildAitunnelTargetedNarrationRepairPrompt(project, sources, narrativePlan, maximumDraft, targetedRepairDiagnostics(maximumDiagnostics));
  const reservations = await reserveV6NarrationEnvelope(project.id, [
    ["narration_full_candidate", candidatePrompt],
    ["narration_full_rewrite", rewritePrompt],
    ["narration_targeted_repair", repairPrompt],
  ]);
  const attempts: FullNarrationAttempt[] = [];
  const calledStages: V6NarrationStage[] = [];
  try {
    const candidate = await requestV6NarrationStage(client, project, "narration_full_candidate", candidatePrompt, reservations, calledStages);
    const candidateAttempt = { stage: "narration_full_candidate" as const, text: candidate, diagnostics: assessFullNarrationDocument(candidate, project, narrativePlan) };
    attempts.push(candidateAttempt);
    logV6NarrationAttemptAssessment(project.id, candidateAttempt);
    let selected = selectBestFullNarrationAttempt(attempts);
    if (selected?.kind === "accepted") {
      await releaseV6UnusedReservations(reservations, ["narration_full_rewrite", "narration_targeted_repair"], "accepted_candidate");
      logV6NarrationRecoveryDecision(project.id, "accepted_candidate", selected, attempts, calledStages, null);
      return selected;
    }

    // A full rewrite is the recovery route for both weak prose and malformed
    // structure. It receives the original candidate plus the fixed contract,
    // so a missing or reordered section must not terminate the user journey
    // before the bounded rewrite has had one chance to repair it.
    let rewritten: string;
    try {
      rewritten = await requestV6NarrationStage(client, project, "narration_full_rewrite", buildAitunnelFullNarrationRewriteWithDraftPrompt(project, sources, narrativePlan, candidate, attempts[0]!.diagnostics), reservations, calledStages);
    } catch (error) {
      return finishV6RecoveryOrThrow(project.id, attempts, calledStages, reservations, error);
    }
    const rewriteAttempt = { stage: "narration_full_rewrite" as const, text: rewritten, diagnostics: assessFullNarrationDocument(rewritten, project, narrativePlan) };
    attempts.push(rewriteAttempt);
    logV6NarrationAttemptAssessment(project.id, rewriteAttempt);
    selected = selectBestFullNarrationAttempt(attempts);
    if (selected?.kind === "accepted") {
      await releaseV6UnusedReservations(reservations, ["narration_targeted_repair"], "accepted_rewrite");
      logV6NarrationRecoveryDecision(project.id, "accepted_rewrite", selected, attempts, calledStages, null);
      return selected;
    }

    if (!isFullNarrationTargetedRepairEligible(rewriteAttempt.diagnostics)) return finishV6Recovery(project.id, attempts, calledStages, reservations, "repair_not_eligible", false);
    logV6NarrationRecoveryDecision(project.id, "repair_eligible", selected, attempts, calledStages, true);
    try {
      const repairRaw = await requestV6NarrationStage(client, project, "narration_targeted_repair", buildAitunnelTargetedNarrationRepairPrompt(project, sources, narrativePlan, rewritten, rewriteAttempt.diagnostics), reservations, calledStages, true);
      const repaired = mergeV6TargetedRepair(rewritten, repairRaw, rewriteAttempt.diagnostics.affectedSlideOrders, project.slideCount);
      const repairAttempt = { stage: "narration_targeted_repair" as const, text: repaired, diagnostics: assessFullNarrationDocument(repaired, project, narrativePlan) };
      attempts.push(repairAttempt);
      logV6NarrationAttemptAssessment(project.id, repairAttempt);
      selected = selectBestFullNarrationAttempt(attempts);
      if (selected?.kind === "accepted") {
        await releaseV6UnusedReservations(reservations, ["narration_full_candidate", "narration_full_rewrite", "narration_targeted_repair"], "accepted_repair");
        logV6NarrationRecoveryDecision(project.id, "accepted_repair", selected, attempts, calledStages, true);
        return selected;
      }
    } catch (error) {
      return finishV6RecoveryOrThrow(project.id, attempts, calledStages, reservations, error);
    }
    return finishV6Recovery(project.id, attempts, calledStages, reservations, "recovery_exhausted", true);
  } catch (error) {
    return finishV6RecoveryOrThrow(project.id, attempts, calledStages, reservations, error);
  }
}

type V6NarrationStage = "narration_full_candidate" | "narration_full_rewrite" | "narration_targeted_repair";
type V6ReservationKeys = Partial<Record<V6NarrationStage, string>> | undefined;
type V6RecoveryDecision =
  | "accepted_candidate"
  | "candidate_not_usable"
  | "accepted_rewrite"
  | "repair_eligible"
  | "repair_not_eligible"
  | "accepted_repair"
  | "recovery_exhausted"
  | "editable_draft_selected"
  | "no_usable_draft"
  | "terminal_provider_or_usage_failure_with_editable_draft"
  | "terminal_provider_or_usage_failure_without_draft"
  | "terminal_budget_failure_with_editable_draft"
  | "terminal_budget_failure_without_draft"
  | "terminal_recovery_failure_with_editable_draft"
  | "terminal_recovery_failure_without_draft";
type V6ProviderResponseStatus = "completed" | "incomplete" | "failed" | "cancelled" | "in_progress" | "queued" | "unknown";
type V6ProviderTerminationReason = "max_output_tokens" | "content_filter" | "unknown";
type V6ProviderTerminationMetadata = {
  hasOutputText: boolean;
  hasUsage: boolean;
  providerResponseStatus?: V6ProviderResponseStatus;
  providerTerminationReason?: V6ProviderTerminationReason;
};

function isFullNarrationCostEnvelopePolicy(version: string | undefined) {
  return version === "standard-generation-cost-envelope-v6" || version === "standard-generation-cost-envelope-v7" || version === "standard-generation-cost-envelope-v8" || version === "standard-generation-cost-envelope-v9" || version === "standard-generation-cost-envelope-v10" || version === "standard-generation-cost-envelope-v11";
}

async function generateLegacyAitunnelNarration(client: OpenAI, model: string, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[], researchBrief?: ResearchBrief): Promise<string> {
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
        section = validateAitunnelNarrationSection(candidate.text, project, narrativePlan, part, aitunnelModelForStage(part.candidateStage)!, part.candidateStage);
        candidateAccepted = true;
      } catch (error) {
        if (!(error instanceof AitunnelNarrationSectionQualityError)) throw error;
        const fallback = await requestAitunnelNarrationCall({
          client, project, narrativePlan, policy, narrationTextCall: part.call,
          stage: part.fallbackStage, prompt: part.fallbackPrompt,
          reservationKey: reservationKeys?.[part.fallbackStage], section: part,
        });
        try {
          section = validateAitunnelNarrationSection(fallback.text, project, narrativePlan, part, aitunnelModelForStage(part.fallbackStage)!, part.fallbackStage);
        } catch (fallbackError) {
          if (!(fallbackError instanceof AitunnelNarrationSectionQualityError) || globalRewriteUsed) throw fallbackError;
          globalRewriteUsed = true;
          const global = await requestAitunnelNarrationCall({
            client, project, narrativePlan, policy, narrationTextCall: part.call,
            stage: "narration_global_rewrite", prompt: part.globalRewritePrompt(fallbackError.reason),
            reservationKey: reservationKeys?.narration_global_rewrite, section: part,
          });
          section = validateAitunnelNarrationSection(global.text, project, narrativePlan, part, aitunnelModelForStage("narration_global_rewrite")!, "narration_global_rewrite");
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

function maximumFullNarrationDraft(project: ProjectInput) {
  const baseWords = Math.floor(800 / project.slideCount);
  const extraWords = 800 % project.slideCount;
  return Array.from({ length: project.slideCount }, (_, index) => {
    // `слово` is a representative Russian spoken-word fixture, not user text.
    // The envelope additionally budgets a 15% token safety margin.
    const words = Array.from({ length: baseWords + (index < extraWords ? 1 : 0) }, (_unused, word) => `слово${index + 1}_${word + 1}`).join(" ");
    return `Слайд ${index + 1}: Раздел ${index + 1}\n${words}.`;
  }).join("\n\n");
}

function targetedRepairDiagnostics(diagnostics: FullNarrationSafeDiagnostics): FullNarrationSafeDiagnostics {
  // The runtime route permits up to three sections. Preflight must reserve
  // that real maximum rather than a one-section fixture.
  return { ...diagnostics, issueCodes: ["fragmentary_section"], affectedSlideOrders: [1, 2, 3], isAccepted: false };
}

async function reserveV6NarrationEnvelope(projectId: string, requests: ReadonlyArray<readonly [V6NarrationStage, string]>): Promise<V6ReservationKeys> {
  const context = currentUsageContext();
  const envelopeId = context?.costEnvelopeId;
  if (!envelopeId) return undefined;
  const policySnapshot = context.costEnvelopeSnapshot?.policy
    || (await getPrisma().costEnvelope.findUniqueOrThrow({ where: { id: envelopeId }, select: { policySnapshot: true } })).policySnapshot;
  const bucketMap = (policySnapshot as { buckets?: Record<string, string> }).buckets || {};
  const inputs = requests.map(([stage, prompt]) => {
    const amountRub = String(bucketMap[stage] || "");
    const estimate = reserveAitunnelStageCall(stage, buildV6NarrationRequest(stage, prompt, stage === "narration_targeted_repair"));
    if (!/^\d+(?:\.\d+)?$/.test(amountRub) || !estimate || Number(estimate.costRub) > Number(amountRub)) {
      logV6NarrationTelemetry(projectId, stage, { failureCategory: "narration_budget_exhausted", preflightReason: "prompt_above_bucket" });
      throw narrationFailure("budget_exhausted");
    }
    return { envelopeId, idempotencyKey: `${envelopeId}:${stage}`, bucket: stage, stage, amountRub };
  });
  const result = await reserveCostEnvelopeBatch(inputs);
  if (result.status !== "reserved") {
    logV6NarrationTelemetry(projectId, "narration_full_candidate", { failureCategory: "narration_budget_exhausted", preflightReason: "batch_blocked" });
    throw narrationFailure("budget_exhausted");
  }
  return Object.fromEntries(inputs.map((input) => [input.stage, input.idempotencyKey])) as Record<V6NarrationStage, string>;
}

async function requestV6NarrationStage(
  client: OpenAI,
  project: ProjectInput,
  stage: V6NarrationStage,
  prompt: string,
  keys: V6ReservationKeys,
  calledStages: V6NarrationStage[],
  json = false,
) {
  return requestV6NarrationCall(client, project, stage, prompt, keys, json, calledStages);
}

async function requestV6NarrationCall(
  client: OpenAI,
  project: ProjectInput,
  stage: V6NarrationStage,
  prompt: string,
  keys: V6ReservationKeys,
  json = false,
  calledStages?: V6NarrationStage[],
): Promise<string> {
  const policy = aitunnelStagePolicy(stage);
  if (!policy.model) throw narrationFailure("budget_exhausted");
  const request = buildV6NarrationRequest(stage, prompt, json);
  const key = keys?.[stage];
  const budget = currentAitunnelProjectBudget();
  if (!key && (!budget || budget.reserve(`v6-${stage}`, stage, request).status !== "reserved")) throw narrationFailure("budget_exhausted");
  const startedAt = new Date();
  calledStages?.push(stage);
  let response: { output_text?: string; usage?: unknown; status?: unknown; incomplete_details?: unknown };
  try {
    response = await client.responses.create(request) as typeof response;
    logV6ProviderTerminationMetadata(project.id, stage, normalizeV6ProviderTerminationMetadata(response));
    await recordOpenAIResponse(response, stage, "studydeck_narration", startedAt, "aitunnel", policy.model, stage === "narration_full_candidate" ? 1 : stage === "narration_full_rewrite" ? 2 : 3, stage);
  } catch {
    if (key) await failCostEnvelope({ envelopeId: currentUsageContext()!.costEnvelopeId!, idempotencyKey: key, reason: "narration_provider_error" }).catch(() => undefined);
    await recordAiUsage({ provider: "aitunnel", model: policy.model, operation: stage, schemaName: "studydeck_narration", attempt: stage === "narration_full_candidate" ? 1 : stage === "narration_full_rewrite" ? 2 : 3, stage, startedAt, error: new Error("narration_provider_error") });
    logV6NarrationTelemetry(project.id, stage, { failureCategory: "provider_error" });
    throw narrationFailure("provider");
  }
  const usage = normalizeOpenAIUsage(response.usage);
  if (key) {
    if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) {
      await settleCostEnvelope({ envelopeId: currentUsageContext()!.costEnvelopeId!, idempotencyKey: key, reason: "usage_unavailable" });
      throw narrationFailure("usage_unavailable");
    }
    const priced = calculateProviderCost("aitunnel", policy.model, startedAt, usage);
    if (priced.status !== "priced" || !priced.sourceCost || (await settleCostEnvelope({ envelopeId: currentUsageContext()!.costEnvelopeId!, idempotencyKey: key, actualRub: priced.sourceCost, reason: "usage_reported" })).status !== "settled") throw narrationFailure("budget_overrun");
  } else if (budget!.settle(`v6-${stage}`, usage).status !== "settled") {
    throw narrationFailure("usage_unavailable");
  }
  logV6NarrationTelemetry(project.id, stage, { outcome: "completed" });
  return response.output_text || "";
}

/** Keep persisted-envelope estimation byte-for-byte aligned with the provider request. */
function buildV6NarrationRequest(stage: V6NarrationStage, prompt: string, json: boolean) {
  const policy = aitunnelStagePolicy(stage);
  if (!policy.model) throw narrationFailure("budget_exhausted");
  return {
    model: policy.model,
    input: [{ role: "system" as const, content: NARRATION_SYSTEM_PROMPT }, { role: "user" as const, content: prompt }],
    max_output_tokens: policy.maxOutputTokens,
    reasoning: { effort: policy.reasoningEffort, exclude: true },
    ...(json ? { text: { format: { type: "json_object" as const } } } : {}),
  };
}

function mergeV6TargetedRepair(currentDraft: string, raw: string, requestedOrders: readonly number[], slideCount: number) {
  const parsed = aitunnelTargetedNarrationRepairResponseSchema.safeParse(parseJsonText(raw));
  if (!parsed.success) throw narrationFailure("quality");
  const received = Object.keys(parsed.data.replacements).map(Number).sort((left, right) => left - right);
  const expected = [...new Set(requestedOrders)].sort((left, right) => left - right);
  if (received.length !== expected.length || received.some((order, index) => order !== expected[index])) throw narrationFailure("quality");
  const sections = parseNarrationSections(currentDraft);
  if (sections.length !== slideCount || sections.some((section, index) => section.order !== index + 1)) throw narrationFailure("quality");
  const replacements = new Map<number, string>();
  for (const [orderText, replacement] of Object.entries(parsed.data.replacements)) {
    const replacementSections = parseNarrationSections(replacement);
    const order = Number(orderText);
    if (replacementSections.length !== 1 || replacementSections[0]!.order !== order) throw narrationFailure("quality");
    replacements.set(order, replacement);
  }
  return sections.map((section) => replacements.get(section.order) || `Слайд ${section.order}: ${section.title}\n${section.text}`).join("\n\n");
}

async function finishV6Recovery(
  projectId: string,
  attempts: readonly FullNarrationAttempt[],
  calledStages: readonly V6NarrationStage[],
  keys: V6ReservationKeys,
  decision: Extract<V6RecoveryDecision, "candidate_not_usable" | "repair_not_eligible" | "recovery_exhausted">,
  repairEligible: boolean | null,
): Promise<NarrationGenerationOutcome> {
  await releaseV6UnusedReservations(keys, ["narration_full_candidate", "narration_full_rewrite", "narration_targeted_repair"], decision);
  const outcome = selectBestFullNarrationAttempt(attempts);
  logV6NarrationRecoveryDecision(projectId, decision, outcome, attempts, calledStages, repairEligible);
  if (outcome) {
    if (outcome.kind === "editable_draft") logV6NarrationRecoveryDecision(projectId, "editable_draft_selected", outcome, attempts, calledStages, repairEligible);
    return outcome;
  }
  logV6NarrationRecoveryDecision(projectId, "no_usable_draft", null, attempts, calledStages, repairEligible);
  throw narrationFailure("quality");
}

async function finishV6RecoveryOrThrow(
  projectId: string,
  attempts: readonly FullNarrationAttempt[],
  calledStages: readonly V6NarrationStage[],
  keys: V6ReservationKeys,
  error: unknown,
): Promise<NarrationGenerationOutcome> {
  const outcome = selectBestFullNarrationAttempt(attempts);
  await releaseV6UnusedReservations(keys, ["narration_full_candidate", "narration_full_rewrite", "narration_targeted_repair"], "terminal_narration_failure");
  const decision = v6TerminalFailureDecision(error, outcome);
  logV6NarrationRecoveryDecision(projectId, decision, outcome, attempts, calledStages, null);
  if (outcome) {
    if (outcome.kind === "editable_draft") logV6NarrationRecoveryDecision(projectId, "editable_draft_selected", outcome, attempts, calledStages, null);
    return outcome;
  }
  logV6NarrationRecoveryDecision(projectId, "no_usable_draft", null, attempts, calledStages, null);
  throw error;
}

async function releaseV6UnusedReservations(keys: V6ReservationKeys, stages: readonly V6NarrationStage[], reason: string) {
  const envelopeId = currentUsageContext()?.costEnvelopeId;
  if (!keys || !envelopeId) return;
  for (const stage of stages) await releaseCostEnvelope({ envelopeId, idempotencyKey: keys[stage]!, reason });
}

function logV6NarrationTelemetry(projectId: string, narrationStage: V6NarrationStage, extra: { outcome?: "completed"; failureCategory?: "provider_error" | "narration_budget_exhausted"; preflightReason?: "prompt_above_bucket" | "batch_blocked" }) {
  safeV6NarrationLog({ projectId, stage: "drafting_speech", narrationStage, narrationTextCall: v6NarrationTextCall(narrationStage), maxNarrationTextCalls: MAX_AITUNNEL_NARRATION_TEXT_CALLS, provider: "aitunnel", ...extra }, "AITUNNEL narration state transition");
}

function logV6NarrationAttemptAssessment(projectId: string, attempt: FullNarrationAttempt) {
  const diagnostics = attempt.diagnostics;
  safeV6NarrationLog({
    ...v6TelemetryIdentity(projectId),
    stage: "drafting_speech",
    narrationStage: attempt.stage,
    narrationTextCall: v6NarrationTextCall(attempt.stage),
    telemetryEvent: "narration_v6_attempt_assessment",
    sectionCount: diagnostics.sectionWordCounts.length,
    totalWords: diagnostics.totalWords,
    sectionWordCounts: diagnostics.sectionWordCounts,
    issueCodes: diagnostics.issueCodes,
    affectedSlideOrders: diagnostics.affectedSlideOrders,
    isStructurallyUsable: diagnostics.isStructurallyUsable,
    isAccepted: diagnostics.isAccepted,
    severeIssueCount: diagnostics.severeIssueCount,
    structuralIssueCount: diagnostics.structuralIssueCount,
    hasCanonicalSectionCoverage: diagnostics.hasCanonicalSectionCoverage,
    isWithinMaximum: diagnostics.isWithinMaximum,
  }, "AITUNNEL narration attempt assessment");
}

function logV6NarrationRecoveryDecision(
  projectId: string,
  decision: V6RecoveryDecision,
  outcome: NarrationGenerationOutcome | null | undefined,
  attempts: readonly FullNarrationAttempt[],
  calledStages: readonly V6NarrationStage[],
  repairEligible: boolean | null,
) {
  const issueCodes = [...new Set(attempts.flatMap((attempt) => attempt.diagnostics.issueCodes))].sort();
  safeV6NarrationLog({
    ...v6TelemetryIdentity(projectId),
    stage: "drafting_speech",
    telemetryEvent: "narration_v6_recovery_decision",
    decision,
    selectedOutcome: outcome?.kind || "none",
    selectedNarrationStage: outcome?.stage || null,
    attemptStages: attempts.map((attempt) => attempt.stage),
    narrationCallCount: calledStages.length,
    maxNarrationCalls: MAX_AITUNNEL_NARRATION_TEXT_CALLS,
    ...(repairEligible === null ? {} : { repairEligible }),
    issueCodes,
    severeIssueCount: attempts.reduce((total, attempt) => total + attempt.diagnostics.severeIssueCount, 0),
    structuralIssueCount: attempts.reduce((total, attempt) => total + attempt.diagnostics.structuralIssueCount, 0),
  }, "AITUNNEL narration recovery decision");
}

function logV6ProviderTerminationMetadata(projectId: string, narrationStage: V6NarrationStage, metadata: V6ProviderTerminationMetadata) {
  safeV6NarrationLog({
    ...v6TelemetryIdentity(projectId),
    stage: "drafting_speech",
    narrationStage,
    narrationTextCall: v6NarrationTextCall(narrationStage),
    telemetryEvent: "narration_v6_provider_termination",
    ...metadata,
  }, "AITUNNEL narration provider termination metadata");
}

/** Normalizes only bounded provider completion metadata. It never carries response, prompt, or output text. */
export function normalizeV6ProviderTerminationMetadata(response: unknown): V6ProviderTerminationMetadata {
  const value = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const incompleteDetails = value.incomplete_details && typeof value.incomplete_details === "object"
    ? value.incomplete_details as Record<string, unknown>
    : undefined;
  const providerResponseStatus = normalizeV6ProviderResponseStatus(value.status);
  const providerTerminationReason = incompleteDetails ? normalizeV6ProviderTerminationReason(incompleteDetails.reason) : undefined;
  return {
    hasOutputText: typeof value.output_text === "string" && value.output_text.length > 0,
    hasUsage: value.usage !== undefined && value.usage !== null,
    ...(providerResponseStatus ? { providerResponseStatus } : {}),
    ...(providerTerminationReason ? { providerTerminationReason } : {}),
  };
}

function normalizeV6ProviderResponseStatus(value: unknown): V6ProviderResponseStatus | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return ["completed", "incomplete", "failed", "cancelled", "in_progress", "queued"].includes(normalized)
    ? normalized as V6ProviderResponseStatus
    : "unknown";
}

function normalizeV6ProviderTerminationReason(value: unknown): V6ProviderTerminationReason | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return ["max_output_tokens", "content_filter"].includes(normalized)
    ? normalized as V6ProviderTerminationReason
    : "unknown";
}

function v6TerminalFailureDecision(error: unknown, outcome: NarrationGenerationOutcome | null): V6RecoveryDecision {
  const message = error instanceof Error ? error.message : "";
  const hasEditableDraft = outcome?.kind === "editable_draft";
  if (["narration_provider_failure", "narration_usage_unavailable_failure"].includes(message)) {
    return hasEditableDraft
      ? "terminal_provider_or_usage_failure_with_editable_draft"
      : "terminal_provider_or_usage_failure_without_draft";
  }
  if (["narration_budget_exhausted_failure", "narration_budget_overrun_failure"].includes(message)) {
    return hasEditableDraft
      ? "terminal_budget_failure_with_editable_draft"
      : "terminal_budget_failure_without_draft";
  }
  return hasEditableDraft
    ? "terminal_recovery_failure_with_editable_draft"
    : "terminal_recovery_failure_without_draft";
}

function v6TelemetryIdentity(projectId: string) {
  const usage = currentUsageContext();
  return {
    projectId,
    ...(usage?.generationJobId ? { generationJobId: usage.generationJobId } : {}),
    ...(usage?.costEnvelopeId ? { costEnvelopeId: usage.costEnvelopeId } : {}),
  };
}

function v6NarrationTextCall(stage: V6NarrationStage) {
  return stage === "narration_full_candidate" ? 1 : stage === "narration_full_rewrite" ? 2 : 3;
}

function safeV6NarrationLog(payload: Record<string, unknown>, message: string) {
  try {
    logger.info(payload, message);
  } catch {
    // Private diagnostics must never alter a bounded generation outcome.
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
  if (!timing || narrativePlan.length !== project.slideCount) throw narrationFailure("quality");
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
  } catch (_error) {
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
  } catch (_rewriteError) {
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
    parse: (value) => normalizeNarrativePlan(unwrapNarrativePlanResponse(value), project),
    jsonSchema: narrativePlanJsonSchema,
    yandexModelTier: "economy",
    aitunnelStage: "narrative_plan",
    ...options,
  });
}

function unwrapNarrativePlanResponse(value: unknown) {
  let parsed: unknown;
  try {
    parsed = parseJsonOutput(value);
  } catch {
    // `normalizeNarrativePlan` intentionally turns malformed provider output
    // into a deterministic plan; preserve that established recovery path.
    return value;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as { slides?: unknown }).slides)) {
    return (parsed as { slides: unknown[] }).slides;
  }
  // Keep accepting the historical array shape for retries and deterministic
  // tests. New provider calls are constrained by the object-root JSON schema.
  return parsed;
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
      parse: (value): DesignBrief => ensureDesignBriefDirections(
        designBriefSchema.parse(parseJsonOutput(value)),
        project,
        narrativePlan,
        sources.some((source) => Boolean(source.excerpt || source.url)),
      ),
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
        description: "Lazyum structured generation output. User-facing educational text should be in Russian.",
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
    persistedReservation = await reservePersistedAitunnelStageEnvelope(provider, aitunnelStage);
    let response: Awaited<ReturnType<typeof client.responses.create>>;
    try {
      response = await client.responses.create(request);
    } catch (error) {
      if (persistedReservation) {
        await failCostEnvelope({ ...persistedReservation, reason: `${aitunnelStage || "structured_generation"}_provider_error` }).catch(() => undefined);
      }
      throw error;
    }
    const usage = normalizeOpenAIUsage((response as { usage?: unknown }).usage);
    await recordOpenAIResponse(response, "structured_generation_legacy", schemaName, startedAt, provider, model, undefined, aitunnelStage);
    responseUsageRecorded = true;
    if (persistedReservation) {
      if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) {
        await settleCostEnvelope({ ...persistedReservation, reason: `${aitunnelStage || "structured_generation"}_usage_unavailable` });
        throw new Error(`aitunnel_${aitunnelStage || "structured_generation"}_usage_unavailable`);
      }
      const priced = calculateProviderCost("aitunnel", model, startedAt, usage);
      if (priced.status !== "priced" || !priced.sourceCost) {
        await settleCostEnvelope({ ...persistedReservation, reason: `${aitunnelStage || "structured_generation"}_price_unavailable` });
        throw new Error(`aitunnel_${aitunnelStage || "structured_generation"}_price_unavailable`);
      }
      const settledEnvelope = await settleCostEnvelope({ ...persistedReservation, actualRub: priced.sourceCost, reason: "usage_reported" });
      if (settledEnvelope.status !== "settled") throw new Error(`aitunnel_${aitunnelStage || "structured_generation"}_${settledEnvelope.status}`);
    }
    if (budget && reservationKey) {
      const settled = budget.settle(reservationKey, usage);
      if (settled.status !== "settled") throw new Error(settled.status);
    }
    const typedResponse = response as typeof response & { output_parsed?: unknown };
    return typedResponse.output_parsed || response.output_text || "";
  } catch (error) {
    if (persistedReservation) {
      await failCostEnvelope({ ...persistedReservation, reason: `${aitunnelStage || "structured_generation"}_provider_error` }).catch(() => undefined);
    }
    if (!responseUsageRecorded) {
      await recordAiUsage({ provider, model, operation: "structured_generation_legacy", schemaName, startedAt, error });
    }
    throw error;
  }
}

async function reservePersistedAitunnelStageEnvelope(provider: "openai" | "aitunnel", stage: AitunnelStage | undefined) {
  const persistedStages = new Set<AitunnelStage>([
    "narrative_plan",
    "design_brief",
    "presentation",
    "quality_critique",
    "quality_repair",
    "slide_text_repair",
  ]);
  const context = currentUsageContext();
  const envelopeId = provider === "aitunnel" && stage && persistedStages.has(stage) ? context?.costEnvelopeId : undefined;
  if (!envelopeId || !stage) return undefined;
  const envelope = await getPrisma().costEnvelope.findUniqueOrThrow({ where: { id: envelopeId }, select: { policySnapshot: true } });
  const bucket = stage as CostEnvelopeBucket;
  const amountRub = String((envelope.policySnapshot as { buckets?: Record<string, string> }).buckets?.[bucket] || "");
  if (!/^\d+(?:\.\d+)?$/.test(amountRub) || amountRub === "0") throw new Error(`aitunnel_${stage}_missing_policy_bucket`);
  const idempotencyKey = `${envelopeId}:${context?.generationJobId || "direct"}:${stage}`;
  const reservation = await reserveCostEnvelope({ envelopeId, idempotencyKey, bucket, stage, amountRub });
  if (reservation.status !== "reserved") throw new Error(`aitunnel_${stage}_${reservation.reason || "reservation_blocked"}`);
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
