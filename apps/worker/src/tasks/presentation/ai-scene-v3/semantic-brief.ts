import {
  slideSemanticBriefV3Schema,
  type SlideSemanticBriefV3,
} from "@studydeck/shared";
import { sha256, type AiSceneV3SpeechSection } from "./speech-section-map.js";

/** Strict local grounding check for the structured answer supplied by Luna. */
export function validateAiSceneV3SemanticBrief(
  value: unknown,
  section: AiSceneV3SpeechSection,
): SlideSemanticBriefV3 {
  const brief = slideSemanticBriefV3Schema.parse(value);
  if (brief.slideId !== section.slideId || brief.slideOrder !== section.slideOrder || brief.kind !== section.kind) {
    throw new Error("ai_scene_v3_semantic_brief_slide_mismatch");
  }
  if (brief.speechSectionHash !== section.speechSectionHash) throw new Error("ai_scene_v3_semantic_brief_speech_hash_mismatch");
  if (brief.kind === "content" && !brief.anchors.every((anchor) => isVerbatimTrace(anchor.sourceTrace, section.text) && isGrounded(anchor.text, anchor.sourceTrace))) {
    throw new Error("ai_scene_v3_semantic_brief_ungrounded_anchor");
  }
  if (!sameWords(brief.title.text, section.title) && !isGrounded(brief.title.text, section.text)) {
    throw new Error("ai_scene_v3_semantic_brief_ungrounded_title");
  }
  const expectedHash = aiSceneV3SemanticBriefContentHash(brief);
  if (brief.contentHash !== expectedHash) throw new Error("ai_scene_v3_semantic_brief_content_hash_mismatch");
  return brief;
}

export function aiSceneV3SemanticBriefContentHash(brief: Pick<SlideSemanticBriefV3, "slideId" | "slideOrder" | "speechSectionHash" | "title" | "subtitle" | "anchors" | "conclusion" | "visualNarrative">) {
  return sha256({
    slideId: brief.slideId,
    slideOrder: brief.slideOrder,
    speechSectionHash: brief.speechSectionHash,
    title: brief.title.text,
    subtitle: brief.subtitle?.text || "",
    anchors: brief.anchors.map((anchor) => ({ id: anchor.id, text: anchor.text, sourceTrace: anchor.sourceTrace })),
    conclusion: brief.conclusion?.text || "",
    visualNarrative: brief.visualNarrative,
  });
}

/**
 * Selects compact, complete source phrases for the fixed two-line overlay.
 * The full DOCX sentence is retained verbatim as sourceTrace; text is never
 * fabricated from a summary or silently clipped with an ellipsis.
 */
export function buildAiSceneV3CompactGroundedAnchors(speech: string): SlideSemanticBriefV3["anchors"] {
  const sentences = speech.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((value) => value.trim()).filter((value) => value.length >= 18);
  if (sentences.length < 4) throw new Error("ai_scene_v3_insufficient_grounded_sentences");
  const ids = ["anchor:1", "anchor:2", "anchor:3", "anchor:4", "anchor:5", "anchor:6", "anchor:7"] as const;
  return sentences.slice(0, 4).map((sourceTrace, index) => ({
    id: ids[index]!,
    text: compactGroundedPhrase(sourceTrace),
    role: "fact" as const,
    priority: index + 1,
    visualCue: `Visual evidence for source sentence ${index + 1}`,
    sourceTrace,
  }));
}

/** A compact prompt builder; it contains the complete one-slide speech but never requests on-image text. */
export function aiSceneV3SemanticBriefPrompt(section: AiSceneV3SpeechSection) {
  return [
    "Return JSON only for SlideSemanticBriefV3 version 3.",
    "Preserve facts and meaning from the supplied speech section. For a content slide return four to seven complete visual anchors, each with a verbatim or near-verbatim sourceTrace from this section.",
    "Choose concepts that can be shown through imagery, comparison, process, map, or spatial relationship. Do not create one-word fragments, do not repeat the title as conclusion, and do not invent facts.",
    "Do not request any written text, letters, numbers, labels, logos, or watermarks in the eventual background image.",
    `slideId: ${section.slideId}`,
    `slideOrder: ${section.slideOrder}`,
    `kind: ${section.kind}`,
    `title: ${section.title}`,
    `speechSectionHash: ${section.speechSectionHash}`,
    `speech section:\n${section.text}`,
  ].join("\n");
}

function isGrounded(candidate: string, source: string) {
  const sourceTokens = tokenSet(source);
  const candidateTokens = [...tokenSet(candidate)];
  if (candidateTokens.length < 2) return false;
  const overlap = candidateTokens.filter((token) => sourceTokens.has(token)).length;
  return overlap / candidateTokens.length >= 0.72;
}

function isVerbatimTrace(trace: string, source: string) {
  return normalizeForTrace(source).includes(normalizeForTrace(trace));
}

function normalizeForTrace(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
}

function compactGroundedPhrase(source: string) {
  const normalized = source.replace(/\s+/g, " ").trim();
  const candidates = normalized
    .split(/(?:;|:|,)\s*/u)
    .map((candidate) => candidate.trim().replace(/[,;:]$/u, ""))
    .filter((candidate) => candidate.length >= 12 && candidate.length <= 88 && /[\p{L}\p{N}]/u.test(candidate));
  const firstClause = candidates[0];
  const selected = firstClause && firstClause.length < normalized.length ? firstClause : normalized.replace(/[.!?]$/u, "");
  if (selected.length <= 64) return selected;
  const phrase = trimDanglingTail(selected.slice(0, 64).replace(/\s+\S*$/u, "").replace(/[,;:]$/u, "").trim());
  if (phrase.length < 3 || /[,…]$/u.test(phrase)) throw new Error("ai_scene_v3_compact_anchor_unavailable");
  return phrase;
}

function trimDanglingTail(value: string) {
  return value.replace(/\s+(?:и|а|но|по|в|во|на|с|со|из|к|ко|от|для|при|о|об|под|над)$/iu, "").trim();
}

function sameWords(left: string, right: string) {
  return [...tokenSet(left)].join(" ") === [...tokenSet(right)].join(" ");
}

function tokenSet(value: string) {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}
