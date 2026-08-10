import {
    type PresentationDocument,
    type Source
} from "@studydeck/shared";

type ProjectInput = {
  id: string;
  title: string;
  prompt: string;
  scenario: string;
  level: string;
  mode: string;
  slideCount: number;
};
type FallbackGenerationMode = "demo" | "demo-fallback";

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

import { GENERIC_NARRATION_PHRASES, GENERIC_SCREEN_TEXT_PHRASES } from "./constants.js";
import { formatNarrationSection, isRepairableNarrationQualityIssue, narrationHeaderWord, narrationSectionsChanged, parseNarrationSections, repairNarrationQualitySections, repairNarrationSentenceCounts, validateNarrationSections } from "./narration/processing.js";
import { buildFallbackSpeakerNotes, fallbackTitle, normalizePresentation } from "./normalization/presentation.js";
import { hasForbiddenTemplateText, normalizeExactForQuality } from "./quality/orchestration.js";

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
  if (text.length <= maxLength) return text;

  // Visible slide copy must never end halfway through a thought. Keep only a
  // complete sentence prefix when one fits; otherwise let the layout/quality
  // checks handle the complete sentence instead of silently cutting it.
  const completeSentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
  let result = "";
  for (const sentence of completeSentences) {
    const candidate = `${result} ${sentence.trim()}`.trim();
    if (candidate.length > maxLength) break;
    result = candidate;
  }
  if (result) return result;

  const words = text.split(/\s+/).filter(Boolean);
  const selected: string[] = [];
  for (const word of words) {
    const candidate = [...selected, word].join(" ");
    if (candidate.length > maxLength - 1) break;
    selected.push(word);
  }
  return selected.length ? `${selected.join(" ")}.` : "";
}

export function shortenWords(value: string, maxWords: number) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
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
