import { getRussianStudentSpeechTimingBudget, type SpeechTimingProject } from "./speech-timing.js";

/** The portable server-side portion of the v6 narration contract. */
export type FullSpeechContractIssue =
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
  | "planning_formula";

export type FullSpeechContractAssessment = {
  applicable: boolean;
  isAccepted: boolean;
  totalWords: number;
  issueCodes: FullSpeechContractIssue[];
};

type CanonicalSection = { order: number; title: string; text: string };

/**
 * Tests the canonical manual-acceptance rules without returning raw text or
 * numeric diagnostics to callers. It applies to every new preset-backed
 * university format; historical project shapes retain their saved behaviour.
 */
export function assessFullSpeechContract(value: string, project: SpeechTimingProject): FullSpeechContractAssessment {
  const budget = getRussianStudentSpeechTimingBudget(project);
  if (!budget) {
    return { applicable: false, isAccepted: true, totalWords: 0, issueCodes: [] };
  }

  const source = value.replace(/\r\n?/g, "\n").trim();
  const sections = parseCanonicalSections(source);
  const issueCodes = new Set<FullSpeechContractIssue>();
  const headers = source.split("\n").filter((line) => /^\s*\u0421\u043b\u0430\u0439\u0434\s*\d{1,2}\s*:/iu.test(line));
  const expectedOrders = Array.from({ length: project.slideCount }, (_, index) => index + 1);

  if (sections.length !== project.slideCount) issueCodes.add("section_count");
  if (headers.length !== sections.length || headers.some((line) => !/^\s*\u0421\u043b\u0430\u0439\u0434\s*\d{1,2}\s*:/iu.test(line))) issueCodes.add("noncanonical_header");
  if (sections.some((section, index) => section.order !== expectedOrders[index])) issueCodes.add("section_order");

  const sectionTargets = expectedOrders.map((order) => order === 1 ? budget.titleWordTarget : order === project.slideCount ? budget.conclusionWordTarget : budget.contentWordTarget);
  for (const [index, section] of sections.entries()) {
    const words = countWords(section.text);
    const sentences = splitSentences(section.text);
    if (!section.title || !section.text.trim()) {
      issueCodes.add("empty_section");
      continue;
    }
    if (words < 25 || sentences.length < 2) issueCodes.add("fragmentary_section");
    if (words > Math.max(sectionTargets[index]! * 2.5, 300) || sentences.length > 15) issueCodes.add("pathologically_unbalanced_section");
    if (hasProviderCommentary(section.text)) issueCodes.add("provider_commentary");
    if (hasPlanningFormula(section.text)) issueCodes.add("planning_formula");
  }

  if (hasRepeatedCompleteSentence(sections.flatMap((section) => splitSentences(section.text)))) issueCodes.add("template_or_repetition");
  const totalWords = sections.reduce((total, section) => total + countWords(section.text), 0);
  if (totalWords < budget.minWords) issueCodes.add("whole_speech_below_minimum");
  if (budget.maxWords !== undefined && totalWords > budget.maxWords) issueCodes.add("whole_speech_above_maximum");

  return { applicable: true, isAccepted: issueCodes.size === 0, totalWords, issueCodes: [...issueCodes].sort() };
}

function parseCanonicalSections(source: string): CanonicalSection[] {
  const sections: CanonicalSection[] = [];
  let current: CanonicalSection | null = null;
  for (const line of source.split("\n")) {
    const header = line.match(/^\s*\u0421\u043b\u0430\u0439\u0434\s*(\d{1,2})\s*:\s*(.*?)\s*$/iu);
    if (header) {
      if (current) sections.push({ ...current, text: current.text.trim() });
      current = { order: Number(header[1]), title: header[2]!.trim(), text: "" };
    } else if (current) {
      current.text += `${current.text ? "\n" : ""}${line}`;
    }
  }
  if (current) sections.push({ ...current, text: current.text.trim() });
  return sections;
}

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function splitSentences(value: string) {
  return value.match(/[^.!?]+[.!?]+/gu)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

function hasRepeatedCompleteSentence(sentences: readonly string[]) {
  const seen = new Set<string>();
  for (const sentence of sentences) {
    const normalized = sentence.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
    if (normalized.split(" ").length < 5) continue;
    if (seen.has(normalized)) return true;
    seen.add(normalized);
  }
  return false;
}

function hasProviderCommentary(value: string) {
  return /(?:\bas an ai\b|\bi cannot\b|\bhere is (?:the )?(?:rewritten|requested)\b|\bvalidation\b|\bword count\b|\bprovider\b|\bprompt\b|\binstruction(?:s)?\b)/iu.test(value);
}

function hasPlanningFormula(value: string) {
  return /(?:\u0441\u043e\u0431\u0440\u0430\u0442\u044c \u043e\u0442\u0432\u0435\u0442 \u043d\u0430 \u0433\u043b\u0430\u0432\u043d\u044b\u0439 \u0432\u043e\u043f\u0440\u043e\u0441|\u0441\u0432\u044f\u0437\u0430\u0442\u044c \u0435\u0433\u043e \u0441 \u043f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u043c\u0438 \u0441\u043c\u044b\u0441\u043b\u043e\u0432\u044b\u043c\u0438 \u0448\u0430\u0433\u0430\u043c\u0438)/iu.test(value);
}
