import crypto from "node:crypto";
import OpenAI from "openai";
import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { getRussianStudentSpeechTimingBudget, russianSpeechMinutesFromWords } from "@studydeck/shared";
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

export type SpokenNarrationIssue = {
  order: number;
  code: "plan_echo" | "repeated_sentence" | "repeated_fact" | "semicolon_run" | "planning_formula";
  message: string;
};

// These codes intentionally contain no counts, slide identifiers, narration,
// or validator text.  They are the only timing detail safe to carry into an
// AITUNNEL recovery request or telemetry.
export type AitunnelNarrationTimingReason =
  | "whole_speech_below_minimum"
  | "whole_speech_above_maximum"
  | "section_below_minimum"
  | "section_above_maximum"
  | "section_sentence_count";

export type NarrationRecoveryStage = "narration_full_candidate" | "narration_full_rewrite" | "narration_targeted_repair";
export type FullNarrationIssueCode =
  | "section_count"
  | "section_order"
  | "noncanonical_header"
  | "empty_section"
  | "fragmentary_section"
  | "pathologically_unbalanced_section"
  | "whole_speech_below_minimum"
  | "whole_speech_above_maximum"
  | "template_or_repetition"
  | "provider_commentary"
  | "prompt_echo"
  | "planning_formula";

/** Safe to place in a provider rewrite request or private telemetry: no draft text or raw validator prose. */
export type FullNarrationSafeDiagnostics = {
  totalWords: number;
  sectionWordCounts: number[];
  issueCodes: FullNarrationIssueCode[];
  affectedSlideOrders: number[];
  isStructurallyUsable: boolean;
  isAccepted: boolean;
  severeIssueCount: number;
  structuralIssueCount: number;
  hasCanonicalSectionCoverage: boolean;
  isWithinMaximum: boolean;
};

export type NarrationGenerationOutcome =
  | { kind: "accepted"; text: string; stage: NarrationRecoveryStage }
  | { kind: "editable_draft"; text: string; stage: NarrationRecoveryStage };

export type FullNarrationAttempt = {
  stage: NarrationRecoveryStage;
  text: string;
  diagnostics: FullNarrationSafeDiagnostics;
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
  modelTier?: YandexModelTier;
  narrationTextCall?: 1 | 2;
  maxNarrationTextCalls?: number;
};

type PromptArtifacts = Partial<Pick<GenerationPipelineArtifacts, "researchBrief" | "deckStory" | "designBrief" | "slideBlueprints" | "slideTextPlans">>;

import type { YandexCompletionResponse } from "../constants.js";
import { STUDENT_CREATION_BRIEF_LINES, NARRATION_SYSTEM_PROMPT, SYSTEM_PROMPT, QUALITY_CRITIC_SYSTEM_PROMPT, QUALITY_REPAIR_SYSTEM_PROMPT, GENERIC_NARRATION_PHRASES, GENERIC_SCREEN_TEXT_PHRASES, TEMPLATE_TEXT_PATTERNS, GENERIC_TITLES, STOP_WORDS, REMOVED_SLIDE_LAYOUTS, SLIDE_LAYOUTS, CONTENT_LAYOUT_CYCLE } from "../constants.js";
import { getYandexModelConfig, type YandexModelTier } from "../prompts/builders.js";
import { emptyVisual, fallbackTitle, buildSlideNarration, buildNarrationFromContent, sentenceCount, speechSentences, sentenceEdgeKey, fallbackSlideText, buildFallbackSpeakerNotes } from "../normalization/presentation.js";
import { looksLikeSentenceFragment, qualityIssuesForText, textSimilarity, significantTokens, normalizeForQuality, normalizeExactForQuality, hasForbiddenTemplateText } from "../quality/orchestration.js";
import { cleanMultilineText, cleanText, sanitizeSpeechText } from "../utilities.js";
import { jsonSchema } from "../schemas.js";

export function shouldRetryNarration(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("AI narration quality check failed") ||
    message.includes("expected") && message.includes("narration sections") ||
    message.includes("missing narration section") ||
    message.includes("adjacent narration sections repeat") ||
    message.includes("narration sections repeat") ||
    message.includes("template phrase detected") ||
    message.includes("response is not plain slide narration") ||
    message.includes("Yandex generation response did not include text")
  );
}

export async function requestYandexText(apiKey: string, systemText: string, userText: string, options: YandexTextOptions = {}) {
  const startedAt = new Date();
  const model = getYandexModelConfig(options.modelTier);
  const useJsonSchema = options.jsonSchema && isYandexJsonSchemaCompatible(options.jsonSchema);
  const responseFormat = useJsonSchema
    ? { json_schema: { schema: options.jsonSchema } }
    : options.jsonSchema || options.jsonObject
      ? { json_object: true }
      : {};
  let response: Response;
  try {
  response = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      modelUri: model.uri,
      completionOptions: {
        stream: false,
        temperature: options.temperature ?? 0.25,
        maxTokens: String(options.maxTokens ?? 8000),
      },
      ...responseFormat,
      messages: [
        {
          role: "system",
          /* legacyText:
            "Ты создаешь учебные презентации на русском языке. На каждом слайде нужен короткий текст для экрана: заголовок и 1-2 содержательные фразы без маркеров. Подробный связный текст для чтения пиши только в speakerNotes и speechScript. Не упоминай источники в тексте для пользователя, не пиши инструкции, заглушки или просьбы что-то проверить. Верни только валидный JSON.",
          */ text: systemText,
        },
        {
          role: "user",
          text: userText,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Yandex generation request failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as YandexCompletionResponse;
  const usage = payload.result?.usage || payload.usage;
  if (options.narrationTextCall) {
    logger.info({
      provider: "yandex",
      model: model.model,
      modelVersion: payload.result?.modelVersion || null,
      narrationTextCall: options.narrationTextCall,
      maxNarrationTextCalls: options.maxNarrationTextCalls || null,
      ...yandexNarrationCompletionTelemetry(payload, options.maxTokens ?? 8000),
    }, "Yandex narration completion metadata");
  }
  await recordAiUsage({
    provider: "yandex",
    model: model.model,
    operation: options.jsonSchema || options.jsonObject ? "structured_generation" : "text_generation",
    providerRequestId: payload.requestId || response.headers.get("x-request-id") || undefined,
    usage: usage ? {
      inputTokens: safeTokenCount(usage.inputTextTokens),
      outputTokens: safeTokenCount(usage.completionTokens),
      reasoningTokens: safeTokenCount(usage.completionTokensDetails?.reasoningTokens),
      totalTokens: safeTokenCount(usage.totalTokens),
    } : undefined,
    startedAt,
  });
  const outputText = payload.result?.alternatives?.[0]?.message?.text || payload.alternatives?.[0]?.message?.text;

  if (!outputText) {
    throw new Error("Yandex generation response did not include text");
  }

  return outputText;
  } catch (error) {
    await recordAiUsage({ provider: "yandex", model: model.model, operation: options.jsonSchema || options.jsonObject ? "structured_generation" : "text_generation", startedAt, error });
    throw error;
  }
}

export function safeTokenCount(value: string | undefined) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? Math.trunc(result) : undefined;
}

export function yandexNarrationCompletionTelemetry(payload: YandexCompletionResponse, maxTokens: number) {
  const alternative = payload.result?.alternatives?.[0] || payload.alternatives?.[0];
  const outputTokens = safeTokenCount((payload.result?.usage || payload.usage)?.completionTokens);
  const finishReason = normalizeYandexTerminationValue(alternative?.finishReason);
  const alternativeStatus = normalizeYandexTerminationValue(alternative?.status);
  const terminationSignal = finishReason === "length"
    ? "output_cap"
    : finishReason === "content_filter"
      ? "content_filter"
      : finishReason === "stop"
        ? "natural_stop"
        : outputTokens !== undefined && outputTokens >= maxTokens
          ? "output_cap_suspected"
          : alternativeStatus === "alternative_status_final"
            ? "final_without_finish_reason"
            : "unknown";

  return {
    alternativeStatus,
    finishReason,
    terminationSignal,
    outputTokens: outputTokens ?? null,
    maxTokens,
  };
}

function normalizeYandexTerminationValue(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function isYandexJsonSchemaCompatible(schema: unknown): boolean {
  if (Array.isArray(schema)) {
    return schema.every(isYandexJsonSchemaCompatible);
  }

  if (!schema || typeof schema !== "object") {
    return true;
  }

  const node = schema as Record<string, unknown>;
  if (node.type === "object" && node.additionalProperties !== false) {
    return false;
  }

  return Object.values(node).every(isYandexJsonSchemaCompatible);
}

export function normalizeNarrationText(value: unknown, project: ProjectInput, narrativePlan: SlideNarrative[] = []) {
  const text = cleanMultilineText(value);
  if (!text || text.startsWith("{")) {
    throw new Error("AI narration quality check failed: response is not plain slide narration");
  }

  let sections = repairShortNarrationSections(parseNarrationSections(text), project);
  let issues = validateNarrationSections(sections, project, narrativePlan);
  if (issues.length && sections.length === project.slideCount && issues.every(isRepairableNarrationQualityIssue)) {
    sections = repairNarrationQualitySections(sections, project);
    issues = validateNarrationSections(sections, project, narrativePlan);
  }
  if (issues.length) {
    throw new Error(`AI narration quality check failed: ${issues.join("; ")}`);
  }

  const normalizedText = sections.map((section) => `Слайд ${section.order}: ${section.title}\n${section.text}`).join("\n\n");
  const textIssues = qualityIssuesForText(normalizedText, project);
  if (textIssues.length) {
    throw new Error(`AI narration quality check failed: ${textIssues.join("; ")}`);
  }

  return normalizedText;
}

export function parseNarrationSections(value: unknown): NarrationSection[] {
  const lines = cleanMultilineText(value).split("\n");
  const sections: NarrationSection[] = [];
  let current: NarrationSection | null = null;

  for (const line of lines) {
    const header = parseNarrationHeader(line);
    if (header) {
      if (current) {
        current.text = cleanText(current.text);
        sections.push(current);
      }
      current = {
        order: header.order,
        title: header.title,
        text: "",
      };
      continue;
    }

    if (current && line.trim()) {
      current.text = cleanText([current.text, line].filter(Boolean).join(" "));
    }
  }

  if (current) {
    current.text = cleanText(current.text);
    sections.push(current);
  }

  return sections;
}

export function parseNarrationHeader(line: string) {
  const boldNumberedHeader = line.trim().match(/^\*\*(\d{1,3})\s*(?:\)|\.|\]|:|-|–|—)\s*(.+?)\*\*$/);
  if (boldNumberedHeader) {
    const title = cleanText(boldNumberedHeader[2]);
    return title && title.length <= 160 ? { order: Number(boldNumberedHeader[1]), title } : null;
  }

  const text = line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\*\*/, "")
    .replace(/\*\*$/, "")
    .trim();
  if (!text) return null;

  const slideHeader = text.match(/^Слайд\s*(?:№|N|No\.?)?\s*(\d{1,3})\s*[:.\-–—]\s*(.+)$/i);
  const numberedHeader = text.match(/^(\d{1,3})\s*(?:\)|\.|\]|:|-|–|—)\s*(.+)$/);
  const header = slideHeader || numberedHeader;
  if (!header) return null;

  const title = cleanText(header[2].replace(/^\*\*(.+)\*\*$/, "$1").replace(/\*\*$/g, ""));
  if (!title || title.length > 160) return null;

  return { order: Number(header[1]), title };
}

export function validateNarrationSections(sections: NarrationSection[], project: ProjectInput, narrativePlan: SlideNarrative[] = []) {
  const issues: string[] = [];
  const budget = getRussianStudentSpeechTimingBudget(project);
  if (sections.length !== project.slideCount) {
    issues.push(`expected ${project.slideCount} narration sections, got ${sections.length}`);
  }

  for (let index = 0; index < project.slideCount; index += 1) {
    const section = sections[index];
    const expectedOrder = index + 1;
    if (!section) {
      issues.push(`missing narration section for slide ${expectedOrder}`);
      continue;
    }
    if (section.order !== expectedOrder) {
      issues.push(`expected slide ${expectedOrder}, got slide ${section.order}`);
    }
    if (!section.title) {
      issues.push(`slide ${expectedOrder} has no title`);
    }
    const sentences = speechSentences(section.text);
    const count = sentences.length;
    // Two substantial sentences are enough for a concise slide narration.
    // The word-count check below still rejects a thin or fragmentary response.
    if (count < 2 || count > 7) {
      issues.push(`slide ${expectedOrder} must have 2-7 narration sentences, got ${count}`);
    }
    const words = section.text.split(/\s+/).filter(Boolean).length;
    if (words < 25) {
      issues.push(`slide ${expectedOrder} narration is too short for a word-for-word speech, got ${words} words`);
    }
    const roleTarget = budget
      ? (index === 0 ? budget.titleWordTarget : index === project.slideCount - 1 ? budget.conclusionWordTarget : budget.contentWordTarget)
      : 0;
    if (words > (budget ? Math.ceil(roleTarget * 1.35) : 130)) {
      issues.push(`slide ${expectedOrder} narration is too long for one slide, got ${words} words`);
    }
    const genericSentence = sentences.find(isGenericNarrationSentence);
    if (genericSentence) {
      issues.push(`slide ${expectedOrder} contains template narration: ${genericSentence.slice(0, 120)}`);
    }

    const previous = sections[index - 1];
    if (previous) {
      const previousSentences = speechSentences(previous.text);
      const currentSentences = sentences;
      const previousFirst = normalizeForQuality(previousSentences[0] || "");
      const currentFirst = normalizeForQuality(currentSentences[0] || "");
      const previousLast = normalizeForQuality(previousSentences[previousSentences.length - 1] || "");
      const currentLast = normalizeForQuality(currentSentences[currentSentences.length - 1] || "");
      if (previousFirst && previousFirst === currentFirst) {
        issues.push(`adjacent narration sections repeat opening sentence at slides ${expectedOrder - 1}-${expectedOrder}`);
      }
      if (previousLast && previousLast === currentLast) {
        issues.push(`adjacent narration sections repeat closing sentence at slides ${expectedOrder - 1}-${expectedOrder}`);
      }
    }
  }

  const repeatedOpening = repeatedSentenceEdge(sections, "first");
  if (repeatedOpening) {
    issues.push(`narration sections repeat opening phrase: ${repeatedOpening}`);
  }

  const repeatedClosing = repeatedSentenceEdge(sections, "last");
  if (repeatedClosing) {
    issues.push(`narration sections repeat closing phrase: ${repeatedClosing}`);
  }

  if (budget && sections.length === project.slideCount) {
    const totalWords = sections.reduce((total, section) => total + section.text.split(/\s+/).filter(Boolean).length, 0);
    const minutes = russianSpeechMinutesFromWords(totalWords, budget.wordsPerMinute);
    if (totalWords < budget.minWords) {
      issues.push(`narration duration is below ${budget.minMinutes} minutes: ${totalWords} words (${minutes.toFixed(1)} min)`);
    }
    if (budget.maxWords !== undefined && totalWords > budget.maxWords) {
      issues.push(`narration duration exceeds ${budget.maxMinutes} minutes: ${totalWords} words (${minutes.toFixed(1)} min)`);
    }
  }

  issues.push(...findSpokenNarrationIssues(sections, narrativePlan).map((issue) =>
    `[${issue.code}] slide ${issue.order}: ${issue.message}`,
  ));

  return issues;
}

/**
 * v6 full-document gate. It deliberately does not reuse the independent
 * section floors: the 10-slide total is authoritative and role targets are
 * soft guidance. Diagnostics are typed so raw validator prose never has to
 * leave this module.
 */
export function assessFullNarrationDocument(value: unknown, project: ProjectInput, narrativePlan: SlideNarrative[] = []): FullNarrationSafeDiagnostics {
  const text = cleanMultilineText(value);
  const sections = parseNarrationSections(text);
  const expectedOrders = Array.from({ length: 10 }, (_, index) => index + 1);
  const issueCodes = new Set<FullNarrationIssueCode>();
  const affectedOrders = new Set<number>();
  const timing = getRussianStudentSpeechTimingBudget(project);
  const sectionWordCounts = sections.map((section) => wordCount(section.text));
  const headerLines = text.split("\n").filter((line) => parseNarrationHeader(line));

  if (project.slideCount !== 10 || sections.length !== 10) {
    issueCodes.add("section_count");
    expectedOrders.forEach((order) => affectedOrders.add(order));
  }
  if (sections.some((section, index) => section.order !== expectedOrders[index])) {
    issueCodes.add("section_order");
    sections.forEach((section, index) => { if (section.order !== expectedOrders[index]) affectedOrders.add(index + 1); });
  }
  if (headerLines.length !== sections.length || headerLines.some((line) => !/^\s*\u0421\u043b\u0430\u0439\u0434\s*\d{1,2}\s*:/iu.test(line))) {
    issueCodes.add("noncanonical_header");
    expectedOrders.forEach((order) => affectedOrders.add(order));
  }

  const sectionTargets = timing ? expectedOrders.map((order) => order === 1 ? timing.titleWordTarget : order === 10 ? timing.conclusionWordTarget : timing.contentWordTarget) : expectedOrders.map(() => 140);
  for (const [index, section] of sections.entries()) {
    const order = index + 1;
    const words = sectionWordCounts[index] || 0;
    const sentences = speechSentences(section.text);
    if (!section.title || !section.text.trim()) {
      issueCodes.add("empty_section");
      affectedOrders.add(order);
      continue;
    }
    if (words < 25 || sentences.length < 2) {
      issueCodes.add("fragmentary_section");
      affectedOrders.add(order);
    }
    // A generous ceiling catches a pathological text dump without turning the
    // 80/140/100 distribution targets back into hidden hard acceptance rules.
    if (words > Math.max(sectionTargets[index]! * 2.5, 300) || sentences.length > 15) {
      issueCodes.add("pathologically_unbalanced_section");
      affectedOrders.add(order);
    }
    if (sentences.some(isGenericNarrationSentence)) {
      issueCodes.add("template_or_repetition");
      affectedOrders.add(order);
    }
    if (sentences.some((sentence) => isPromptEchoSentence(sentence, project))) {
      issueCodes.add("prompt_echo");
      affectedOrders.add(order);
    }
    if (hasProviderCommentary(section.text)) {
      issueCodes.add("provider_commentary");
      affectedOrders.add(order);
    }
  }

  for (const issue of findSpokenNarrationIssues(sections, narrativePlan)) {
    affectedOrders.add(issue.order);
    issueCodes.add(issue.code === "planning_formula" ? "planning_formula" : "template_or_repetition");
  }

  const totalWords = sectionWordCounts.reduce((total, words) => total + words, 0);
  if (timing && totalWords < timing.minWords) issueCodes.add("whole_speech_below_minimum");
  if (timing?.maxWords !== undefined && totalWords > timing.maxWords) issueCodes.add("whole_speech_above_maximum");

  const structuralCodes: readonly FullNarrationIssueCode[] = ["section_count", "section_order", "noncanonical_header", "empty_section"];
  const severeCodes: readonly FullNarrationIssueCode[] = ["template_or_repetition", "provider_commentary", "prompt_echo", "planning_formula"];
  const structuralIssueCount = [...issueCodes].filter((code) => structuralCodes.includes(code)).length;
  const severeIssueCount = [...issueCodes].filter((code) => severeCodes.includes(code)).length;
  const hasCanonicalSectionCoverage = structuralIssueCount === 0;
  // Template, repetition and commentary defects are semantic repair work;
  // they do not make a complete ten-section draft structurally unusable.
  // Keeping this distinction lets the bounded targeted repair run and, if it
  // still cannot pass, preserves the best real-AI draft for review.
  const isStructurallyUsable = hasCanonicalSectionCoverage;
  const isWithinMaximum = timing?.maxWords === undefined || totalWords <= timing.maxWords;
  return {
    totalWords,
    sectionWordCounts,
    issueCodes: [...issueCodes].sort(),
    affectedSlideOrders: [...affectedOrders].filter((order) => Number.isInteger(order) && order >= 1 && order <= 10).sort((a, b) => a - b),
    isStructurallyUsable,
    isAccepted: isStructurallyUsable && issueCodes.size === 0,
    severeIssueCount,
    structuralIssueCount,
    hasCanonicalSectionCoverage,
    isWithinMaximum,
  };
}

/** A bounded batch repair is meaningful only for localised section defects. */
export function isFullNarrationTargetedRepairEligible(diagnostics: FullNarrationSafeDiagnostics) {
  const targetedCodes: readonly FullNarrationIssueCode[] = [
    "fragmentary_section",
    "pathologically_unbalanced_section",
    "template_or_repetition",
    "provider_commentary",
    "prompt_echo",
    "planning_formula",
  ];
  return diagnostics.isStructurallyUsable
    && diagnostics.issueCodes.length > 0
    // A local fragment normally also makes the whole document short.  That
    // aggregate symptom must not block the one bounded local repair.
    && diagnostics.issueCodes.every((code) => targetedCodes.includes(code) || code === "whole_speech_below_minimum")
    && diagnostics.affectedSlideOrders.length > 0
    && diagnostics.affectedSlideOrders.length <= 3;
}

/**
 * Selects an accepted result immediately, otherwise ranks only in-memory,
 * structurally usable attempts for the editable-draft recovery path.
 */
export function selectBestFullNarrationAttempt(attempts: readonly FullNarrationAttempt[]): NarrationGenerationOutcome | null {
  const accepted = attempts.find((attempt) => attempt.diagnostics.isAccepted);
  if (accepted) return { kind: "accepted", text: accepted.text, stage: accepted.stage };
  const eligible = attempts.filter((attempt) => attempt.diagnostics.isStructurallyUsable);
  if (!eligible.length) return null;
  const stageRank: Record<NarrationRecoveryStage, number> = {
    narration_full_candidate: 0,
    narration_full_rewrite: 1,
    narration_targeted_repair: 2,
  };
  const targetWords = 1300;
  const best = [...eligible].sort((left, right) => {
    const leftIssues = left.diagnostics.severeIssueCount + left.diagnostics.structuralIssueCount;
    const rightIssues = right.diagnostics.severeIssueCount + right.diagnostics.structuralIssueCount;
    if (leftIssues !== rightIssues) return leftIssues - rightIssues;
    if (left.diagnostics.hasCanonicalSectionCoverage !== right.diagnostics.hasCanonicalSectionCoverage) return left.diagnostics.hasCanonicalSectionCoverage ? -1 : 1;
    if (left.diagnostics.isWithinMaximum !== right.diagnostics.isWithinMaximum) return left.diagnostics.isWithinMaximum ? -1 : 1;
    const leftDistance = Math.abs(left.diagnostics.totalWords - targetWords);
    const rightDistance = Math.abs(right.diagnostics.totalWords - targetWords);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    if (left.diagnostics.totalWords < targetWords && right.diagnostics.totalWords < targetWords && left.diagnostics.totalWords !== right.diagnostics.totalWords) return right.diagnostics.totalWords - left.diagnostics.totalWords;
    return stageRank[left.stage] - stageRank[right.stage];
  })[0]!;
  return { kind: "editable_draft", text: best.text, stage: best.stage };
}

function hasProviderCommentary(value: string) {
  return /(?:\bas an ai\b|\bi cannot\b|\bhere is (?:the )?(?:rewritten|requested)\b|\bvalidation\b|\bword count\b|\bprovider\b|\bprompt\b|\binstruction(?:s)?\b)/iu.test(value);
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

/**
 * Produces a deliberately small, typed timing diagnosis for AITUNNEL only.
 * Keep this separate from validateNarrationSections' human-readable issues:
 * those include values and slide details that must not leave local validation.
 */
export function findAitunnelNarrationTimingReasons(sections: NarrationSection[], project: ProjectInput): AitunnelNarrationTimingReason[] {
  const budget = getRussianStudentSpeechTimingBudget(project);
  const reasons = new Set<AitunnelNarrationTimingReason>();

  for (let index = 0; index < project.slideCount; index += 1) {
    const section = sections[index];
    if (!section) continue;
    const words = section.text.split(/\s+/).filter(Boolean).length;
    const sentenceCount = speechSentences(section.text).length;
    if (sentenceCount < 2 || sentenceCount > 7) reasons.add("section_sentence_count");
    if (words < 25) reasons.add("section_below_minimum");
    const roleTarget = budget
      ? (index === 0 ? budget.titleWordTarget : index === project.slideCount - 1 ? budget.conclusionWordTarget : budget.contentWordTarget)
      : 0;
    if (words > (budget ? Math.ceil(roleTarget * 1.35) : 130)) reasons.add("section_above_maximum");
  }

  if (budget && sections.length === project.slideCount) {
    const totalWords = sections.reduce((total, section) => total + section.text.split(/\s+/).filter(Boolean).length, 0);
    if (totalWords < budget.minWords) reasons.add("whole_speech_below_minimum");
    if (budget.maxWords !== undefined && totalWords > budget.maxWords) reasons.add("whole_speech_above_maximum");
  }

  return [...reasons];
}

/**
 * Conservative blockers for text that is formally long enough but cannot be
 * read aloud naturally.  These are intentionally deterministic: they only
 * identify a defect; wording is repaired by Yandex, never by local fallback.
 */
export function findSpokenNarrationIssues(sections: NarrationSection[], narrativePlan: SlideNarrative[] = []): SpokenNarrationIssue[] {
  const issues: SpokenNarrationIssue[] = [];
  const planByOrder = new Map(narrativePlan.map((item) => [item.slideOrder, item]));
  const seenSentences = new Map<string, number>();

  for (const section of sections) {
    const sentences = speechSentences(section.text);
    const plan = planByOrder.get(section.order);
    const protectedPlanFields = [plan?.slidePurpose, plan?.audienceQuestion]
      .map((value) => normalizeExactForQuality(String(value || "")))
      .filter((value) => value.length >= 12);

    for (const sentence of sentences) {
      const key = normalizeExactForQuality(sentence).replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
      if (!key) continue;
      if (protectedPlanFields.some((field) => key === field || key.includes(field))) {
        issues.push({ order: section.order, code: "plan_echo", message: "narration repeats a narrative-plan field" });
      }
      const previousOrder = seenSentences.get(key);
      if (previousOrder !== undefined && key.split(" ").length >= 5) {
        issues.push({
          order: section.order,
          code: previousOrder === section.order ? "repeated_sentence" : "repeated_fact",
          message: previousOrder === section.order ? "section repeats a complete sentence" : `repeats a complete fact from slide ${previousOrder}`,
        });
      } else {
        seenSentences.set(key, section.order);
      }
    }

    const semicolons = (section.text.match(/;/g) || []).length;
    if (/,\s*;/u.test(section.text) || semicolons >= 4) {
      issues.push({ order: section.order, code: "semicolon_run", message: "narration contains an abnormal semicolon sequence" });
    }
    const finalSentence = sentences[sentences.length - 1] || "";
    if (/\?$/.test(finalSentence) && /(?:нужно|следует|как|почему|каков|какая|какие)\b/iu.test(finalSentence)) {
      issues.push({ order: section.order, code: "planning_formula", message: "narration ends with an unresolved planning question" });
    }
    if (/(?:собрать ответ на главный вопрос|связать его с предыдущими смысловыми шагами|оставить 2[–-]3 разных подтвержденных вывода)/iu.test(section.text)) {
      issues.push({ order: section.order, code: "planning_formula", message: "narration contains a planning formula" });
    }
  }

  return issues.filter((issue, index, all) => all.findIndex((candidate) => candidate.order === issue.order && candidate.code === issue.code && candidate.message === issue.message) === index);
}

export function isRepairableNarrationQualityIssue(issue: string) {
  return issue.includes("narration is too short")
    || issue.includes("must have 2-7 narration sentences")
    || issue.includes("repeat opening sentence")
    || issue.includes("repeat closing sentence")
    || issue.includes("repeat opening phrase")
    || issue.includes("repeat closing phrase");
}

export function repairNarrationQualitySections(sections: NarrationSection[], project: ProjectInput): NarrationSection[] {
  return sections.map((section, index) => {
    const order = index + 1;
    const title = cleanText(section.title) || fallbackTitle(project, order);
    const sentences = speechSentences(sanitizeSpeechText(section.text))
      .filter((sentence) => !isGenericNarrationSentence(sentence) && !isPromptEchoSentence(sentence, project));
    const thesis = sentences[0] || fallbackSlideText(project, order);
    return {
      ...section,
      order,
      title,
      text: buildNarrationFromContent(title, thesis, sentences.slice(1), project, order),
    };
  });
}

export function repairNarrationSentenceCounts(sections: NarrationSection[], project: ProjectInput) {
  return repairShortNarrationSections(compressOverlongNarrationSections(sections, project), project).map((section, index) => {
    const expectedOrder = index + 1;
    if (section.order !== expectedOrder || !section.title) {
      return section;
    }

    const count = sentenceCount(section.text);
    if (count >= 2 && count <= 7) {
      return section;
    }
    if (count > 7) {
      return section;
    }

    return {
      ...section,
      text: buildFallbackSpeakerNotes(project, expectedOrder),
    };
  });
}

export function compressOverlongNarrationSections(sections: NarrationSection[], project: ProjectInput) {
  const repaired: NarrationSection[] = [];
  for (const section of sections) {
    const compressed = compressOverlongNarrationSection(section, project, repaired[repaired.length - 1]);
    repaired.push(compressed);
  }
  return repaired;
}

export function compressOverlongNarrationSection(section: NarrationSection, project: ProjectInput, previous?: NarrationSection): NarrationSection {
  const sentences = speechSentences(sanitizeSpeechText(section.text));
  if (sentences.length <= 7) {
    return section;
  }

  const selected: string[] = [];
  const seen = new Set<string>();
  const previousFirst = firstNarrationEdge(previous?.text || "");
  const previousLast = lastNarrationEdge(previous?.text || "");
  const useful = sentences.filter((sentence) => isUsableNarrationSentence(sentence, section, project));
  if (useful.length < 3) {
    return section;
  }

  for (const sentence of useful) {
    const key = normalizeForQuality(sentence);
    if (!key || seen.has(key)) continue;
    if (!selected.length && previousFirst && sentenceEdgeKey(sentence) === previousFirst) continue;
    selected.push(sentence);
    seen.add(key);
    if (selected.length >= 7) break;
  }

  if (selected.length > 3 && previousLast && sentenceEdgeKey(selected[selected.length - 1]) === previousLast) {
    const replacement = useful.find((sentence) => {
      const key = normalizeForQuality(sentence);
      return key && !seen.has(key) && sentenceEdgeKey(sentence) !== previousLast;
    });
    if (replacement) {
      selected[selected.length - 1] = replacement;
    }
  }

  if (selected.length < 3) {
    return section;
  }

  return { ...section, text: selected.slice(0, 7).join(" ") };
}

export function isUsableNarrationSentence(sentence: string, section: NarrationSection, project: ProjectInput) {
  const text = cleanText(sentence);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;
  if (looksLikeSentenceFragment(text)) return false;
  if (isGenericNarrationSentence(text)) return false;
  if (isPromptEchoSentence(text, project)) return false;

  const sectionTokens = new Set(significantTokens(`${section.title} ${project.title}`));
  const sentenceTokens = significantTokens(text);
  if (sectionTokens.size && sentenceTokens.length >= 6) {
    return sentenceTokens.some((token) => sectionTokens.has(token)) || textSimilarity(text, `${section.title} ${project.title} ${project.prompt}`) >= 0.12;
  }

  return true;
}

export function isGenericNarrationSentence(sentence: string) {
  if (/собрать ответ на главный вопрос|связать его с предыдущими смысловыми шагами|оставить 2[–-]3 разных подтвержденных вывода/iu.test(sentence)) {
    return true;
  }
  const normalized = normalizeExactForQuality(sentence);
  const genericFragments = [
    "\u0440\u0430\u0441\u0441\u043a\u0430\u0437 \u043f\u0440\u043e",
    "\u0447\u0442\u043e \u0441\u0442\u043e\u0438\u0442 \u043f\u043e\u043d\u044f\u0442\u044c \u0441\u043d\u0430\u0447\u0430\u043b\u0430",
    "\u0433\u043b\u0430\u0432\u043d\u044b\u0439 \u0432\u044b\u0432\u043e\u0434 \u043f\u043e \u0442\u0435\u043c\u0435",
    "\u0441\u043e\u0431\u0440\u0430\u0442\u044c \u043e\u0442\u0432\u0435\u0442 \u043d\u0430 \u0433\u043b\u0430\u0432\u043d\u044b\u0439 \u0432\u043e\u043f\u0440\u043e\u0441",
    "\u0441\u0432\u044f\u0437\u0430\u0442\u044c \u0435\u0433\u043e \u0441 \u043f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u043c\u0438 \u0441\u043c\u044b\u0441\u043b\u043e\u0432\u044b\u043c\u0438 \u0448\u0430\u0433\u0430\u043c\u0438",
    "\u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c 2\u20133 \u0440\u0430\u0437\u043d\u044b\u0445 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u043d\u044b\u0445 \u0432\u044b\u0432\u043e\u0434\u0430",
    "\u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c 2-3 \u0440\u0430\u0437\u043d\u044b\u0445 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u043d\u044b\u0445 \u0432\u044b\u0432\u043e\u0434\u0430",
    "\u043d\u0430 \u044d\u0442\u043e\u043c \u0441\u043b\u0430\u0439\u0434\u0435",
    "\u044d\u0442\u043e\u0442 \u0441\u043b\u0430\u0439\u0434",
    "\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0430\u044f \u0447\u0430\u0441\u0442\u044c",
    "\u043f\u0435\u0440\u0435\u0445\u043e\u0434 \u043a",
    "\u043d\u043e\u0432\u044b\u0439 \u0448\u0430\u0433",
    "this slide",
    "next section",
    "main takeaway of the topic",
    "one of the most amazing planets",
    "one of the most fascinating planets",
    "одной из самых удивительных планет",
  ];
  return hasForbiddenTemplateText(sentence)
    || GENERIC_NARRATION_PHRASES.some((phrase) => normalized.includes(normalizeExactForQuality(phrase)))
    || genericFragments.some((phrase) => normalized.includes(normalizeExactForQuality(phrase)));
}

export function isPromptEchoSentence(sentence: string, project: ProjectInput) {
  const prompt = cleanText(project.prompt);
  if (!prompt) return false;
  const normalizedSentence = normalizeForQuality(sentence);
  const normalizedPrompt = normalizeForQuality(prompt);
  if (normalizedPrompt && normalizedSentence.includes(normalizedPrompt)) return true;
  return textSimilarity(sentence, prompt) >= 0.7;
}

export function firstNarrationEdge(text: string) {
  return sentenceEdgeKey(speechSentences(text)[0] || "");
}

export function lastNarrationEdge(text: string) {
  const sentences = speechSentences(text);
  return sentenceEdgeKey(sentences[sentences.length - 1] || "");
}

export function formatNarrationSection(section: NarrationSection, slideWord = "\u0421\u043b\u0430\u0439\u0434") {
  return `${slideWord} ${section.order}: ${section.title}\n${section.text}`;
}

export function narrationSectionsChanged(before: NarrationSection[], after: NarrationSection[]) {
  if (before.length !== after.length) return true;
  return after.some((section, index) => {
    const previous = before[index];
    return !previous || previous.order !== section.order || previous.title !== section.title || previous.text !== section.text;
  });
}

export function narrationHeaderWord(value: string) {
  const firstHeader = cleanMultilineText(value)
    .split("\n")
    .map((line) => line.match(/^(\S+)\s+\d+\s*:/i)?.[1])
    .find(Boolean);
  return firstHeader || "\u0421\u043b\u0430\u0439\u0434";
}

export function repeatedSentenceEdge(sections: NarrationSection[], edge: "first" | "last") {
  const counts = new Map<string, number>();
  for (const section of sections) {
    const sentences = speechSentences(section.text);
    const sentence = edge === "first" ? sentences[0] : sentences[sentences.length - 1];
    const key = sentenceEdgeKey(sentence || "");
    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return [...counts.entries()].find(([, count]) => count >= 3)?.[0] || "";
}

export function repairShortNarrationSections(sections: NarrationSection[], project: ProjectInput) {
  return sections.map((section, index) => {
    const expectedOrder = index + 1;
    if (section.order !== expectedOrder || !section.title) {
      return section;
    }

    const sentences = speechSentences(section.text);
    const words = section.text.split(/\s+/).filter(Boolean).length;
    if ((sentences.length >= 2 && words >= 25) || sentences.length === 0) {
      return section;
    }

    const additions = speechSentences(
      buildSlideNarration(
        {
          title: section.title,
          thesis: sentences[0] || fallbackSlideText(project, expectedOrder),
          bullets: sentences.slice(1),
          definition: null,
          visual: emptyVisual(),
        },
        project,
        expectedOrder,
      ),
    );
    const repaired = [...sentences];
    const seen = new Set(repaired.map(normalizeForQuality).filter(Boolean));

    for (const addition of additions) {
      const key = normalizeForQuality(addition);
      if (!key || seen.has(key)) {
        continue;
      }
      repaired.push(addition);
      seen.add(key);
      if (repaired.length >= 2) {
        break;
      }
    }

    const completed = repaired.slice(0, 7).join(" ");
    return sentenceCount(completed) >= 2 && completed.split(/\s+/).filter(Boolean).length >= 25
      ? { ...section, text: completed }
      : { ...section, text: buildMinimumNarration(section, project, expectedOrder) };
  });
}

export function buildMinimumNarration(section: NarrationSection, project: ProjectInput, order: number) {
  const title = cleanText(section.title) || fallbackTitle(project, order);
  const topic = cleanText(project.title) || cleanText(project.prompt) || title;
  return [
    `${title} раскрывает один из ключевых аспектов работы «${topic}».`,
    "Этот аспект связан с поставленной задачей и помогает обосновать выбранный подход.",
    "Его практическая ценность проявляется в возможности последовательно представить ход работы и полученные результаты.",
  ].join(" ");
}
