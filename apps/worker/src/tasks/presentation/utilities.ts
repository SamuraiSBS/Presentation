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
import { parseNarrationSections, validateNarrationSections, isRepairableNarrationQualityIssue, repairNarrationQualitySections, repairNarrationSentenceCounts, formatNarrationSection, narrationSectionsChanged, narrationHeaderWord } from "./narration/processing.js";
import { normalizePresentation, fallbackTitle, buildFallbackSpeakerNotes } from "./normalization/presentation.js";
import { normalizeExactForQuality, hasForbiddenTemplateText } from "./quality/orchestration.js";

export function parseJsonText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("AI response has no JSON text");
  }

  return JSON.parse(trimmed);
}

export function normalizeGeneratedText(value: string, project: ProjectInput) {
  const text = cleanGeneratedText(value);
  if (!text || text.startsWith("{") || !/Слайд\s+1\s*:/i.test(text)) {
    return buildFallbackGeneratedText(project);
  }

  const sanitized = sanitizeGeneratedText(text);
  const originalSections = parseNarrationSections(sanitized);
  const sections = repairNarrationSentenceCounts(originalSections, project);
  const issues = validateNarrationSections(sections, project);
  if (!issues.length) {
    if (!narrationSectionsChanged(originalSections, sections)) {
      return sanitized;
    }
    const slideWord = narrationHeaderWord(sanitized);
    return sections.map((section) => formatNarrationSection(section, slideWord)).join("\n\n");
  }

  if (sections.length === project.slideCount) {
    const blockingIssues = issues.filter((issue) => !isRepairableNarrationQualityIssue(issue));
    if (!blockingIssues.length) {
      const slideWord = narrationHeaderWord(sanitized);
      return repairNarrationQualitySections(sections, project).map((section) => formatNarrationSection(section, slideWord)).join("\n\n");
    }
  }

  return sanitized;
}

export function cleanGeneratedText(value: unknown) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeGeneratedText(value: string) {
  return cleanGeneratedText(value)
    .split("\n")
    .map((line) => {
      const text = line.trim();
      if (!text) return "";
      return /^Слайд\s+\d+\s*:/i.test(text) ? text : sanitizeSpeechText(text);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildFallbackGeneratedText(project: ProjectInput) {
  return Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const title = fallbackTitle(project, order);
    const body = buildFallbackSpeakerNotes(project, order);
    return `Слайд ${order}: ${title}\n${body}`;
  }).join("\n\n");
}

export function cleanMultilineText(value: unknown) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

export function projectTopic(project: ProjectInput) {
  const title = stripPromptInstructions(cleanText(project.title));
  const promptTopic = extractTopicFromPrompt(project.prompt);
  if (title && !looksLikePromptInstruction(title)) {
    return title;
  }
  return promptTopic || stripPromptInstructions(cleanText(project.prompt)) || title || "Материал";
}

export function cleanPresentationTitle(value: unknown, project: ProjectInput) {
  const title = stripPromptInstructions(cleanText(value));
  return title && !looksLikePromptInstruction(title) ? title : projectTopic(project);
}

export function extractTopicFromPrompt(value: unknown) {
  const text = cleanText(value);
  const match = text.match(/по\s+теме\s*:\s*([^.!?\n]+)(?:[.!?]|$)/iu);
  return stripTopicQuotes(match?.[1] || "");
}

export function stripPromptInstructions(value: string) {
  const promptTopic = extractTopicFromPrompt(value);
  if (promptTopic) return promptTopic;
  return cleanText(value)
    .replace(/^подготовь\s+академическ(?:ую|ий).{0,220}?по\s+теме\s*:?\s*/iu, "")
    .replace(/^сделай\s+презентаци\w*\s+(?:на\s+\d+\s+слайд\w*\s+)?(?:по|про|о)\s+/iu, "")
    .replace(/^создай\s+презентаци\w*\s+(?:на\s+\d+\s+слайд\w*\s+)?(?:по|про|о)\s+/iu, "")
    .split(/[.!?]\s+/)[0]
    .trim();
}

export function stripTopicQuotes(value: string) {
  return cleanText(value).replace(/^[«"'`]+|[»"'`]+$/g, "").trim();
}

export function looksLikePromptInstruction(value: string) {
  const normalized = normalizeExactForQuality(value);
  return normalized.includes("подготовь академическую")
    || normalized.includes("студенческую презентацию")
    || normalized.includes("слайдов по теме");
}

export function sanitizeScreenText(value: unknown) {
  return removeBannedSentences(cleanText(value).replace(/^#+\s*/g, ""));
}

export function sanitizeSpeechText(value: unknown) {
  return removeBannedSentences(cleanText(value));
}

export function removeBannedSentences(value: string) {
  const banned = [
    "источник",
    "источники",
    "source",
    "sourceRefs",
    "проверьте",
    "проверить",
    "добавьте",
    "добавить источник",
    "добавлю несколько деталей",
    "ключевой вывод нужно связать",
    "тезис нужно объяснить",
    "основная мысль слайда",
    "сделай презентацию",
    "сделайте презентацию",
    "создай презентацию",
    "создайте презентацию",
    "нужно раскрыть через конкретные факты",
    "раскрыть через конкретные факты",
    ...GENERIC_NARRATION_PHRASES,
    ...GENERIC_SCREEN_TEXT_PHRASES,
  ];
  const parts = value
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const filtered = parts.filter((part) => {
    const lower = part.toLowerCase();
    return !banned.some((phrase) => lower.includes(phrase.toLowerCase()))
      && !hasForbiddenTemplateText(part);
  });

  return filtered.join(" ").trim();
}

export function shortenSentence(value: string, maxLength: number) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

export function shortenWords(value: string, maxWords: number) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}...` : words.join(" ");
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function demoPresentation(project: ProjectInput, sources: Source[], generationMode: FallbackGenerationMode): PresentationDocument {
  return normalizePresentation({}, project, sources, generationMode);
}
