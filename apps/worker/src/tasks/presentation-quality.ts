import {
  auditSlideCanvas,
  auditGeneratedCanvasText,
  ensureEditableCanvas,
  normalizeSourceRefs,
  sourceRefFromSource,
  hasCustomSlideCanvas,
  presentationSchema,
  resolvePresentationTheme,
  getRussianStudentSpeechTimingBudget,
  russianSpeechMinutesFromWords,
  type PresentationDocument,
  type QualityCritique,
  type QualityDimensionScore,
  type QualityDimensions,
  type QualityIssue,
  type Slide,
  type Source,
  type DesignBriefSlideDirection,
} from "@studydeck/shared";
import { errorLogFields, logger } from "../observability.js";
import { STOP_WORDS } from "./presentation/constants.js";
import { hasGenericOrMetaScreenText } from "./presentation/quality/orchestration.js";
import {
  findLongSlideTextIssues,
  isVisibleTextTooLong,
} from "./presentation/quality/visible-text-rules.js";
import { normalizeVisual } from "./presentation/normalization/presentation.js";
import { collectSemanticQualityIssues } from "./presentation/quality/semantic-rules.js";
import { collectSourceGroundingIssues } from "./presentation/quality/source-grounding.js";
import { applyInitialQualityRepairs } from "./presentation/quality/repair-orchestration.js";
import { hasSubstantiveVisual, isManagedSlideCount } from "./presentation/visual-policy.js";

export { findLongSlideTextIssues, isVisibleTextTooLong } from "./presentation/quality/visible-text-rules.js";
export { hasSubstantiveVisual } from "./presentation/visual-policy.js";

export type QualityProjectInput = {
  id: string;
  title: string;
  prompt: string;
  scenario: string;
  level: string;
  mode: string;
  slideCount: number;
  generationBrief?: unknown;
  researchBrief?: unknown;
  mandatorySourceSnapshot?: boolean;
  acceptedNarrationRecovery?: boolean;
};

export type GenerationMode = "openai" | "yandex" | "aitunnel" | "local" | "demo" | "demo-fallback";

export type QualityRepairResponse = {
  generatedText?: unknown;
  outline?: unknown;
  speechScript?: unknown;
  slides?: Array<Partial<Slide> & { slideId?: string; slideOrder?: number }>;
};

export type ImprovePresentationQualityOptions = {
  critique?: (presentation: PresentationDocument, deterministic: QualityCritique) => Promise<unknown>;
  repair?: (
    presentation: PresentationDocument,
    issues: QualityIssue[],
    attempt: number,
  ) => Promise<unknown>;
  maxRepairAttempts?: number;
};

export type ProductionQualityReleaseResult = {
  issueCategories: string[];
  attempts: number;
  finalDisposition: "released" | "rejected";
  issues: Array<{ slideId?: string; field: string; severity: QualityIssue["severity"]; category: QualityIssue["category"]; repairable: boolean }>;
};

type QualityTextEntry = {
  slide: Slide;
  field: string;
  value: string;
};

export type TopicProfile = {
  tokens: string[];
  anchors: string[];
  allowedEntities: string[];
  timeRange: string;
  domainAnchors: string[];
};

export type SlideSemanticContract = {
  slideOrder: number;
  narrativeTitle: string;
  keyMessage: string;
  acceptedNarration: string;
  speakerNotes: string;
  speechScript: string;
  visibleText: string;
};

export type SlideSpeechAlignmentScore = {
  slideOrder: number;
  score: number;
  visibleToAccepted: number;
  visibleToKeyMessage: number;
  notesToScript: number;
  notesToAccepted: number;
  scriptToAccepted: number;
  hasMatchingScript: boolean;
};

const QUALITY_SCORE_THRESHOLD = 82;
const MAX_DEFAULT_REPAIR_ATTEMPTS = 2;
const WEAK_DIMENSION_THRESHOLD = 78;

const CHILDISH_OR_SCHOOL_COPY = [
  /(?:^|\s)(?:ребята|детишки|малыши|школьники)(?:\s|$)/iu,
  /(?:для|в)\s+(?:детей|школе|классе)/iu,
  /(?:начальн\w+\s+школ|школьн\w+\s+урок|классн\w+\s+час)/iu,
  /(?:kids?|children|schoolchildren|little learners)/iu,
];

export const BANNED_QUALITY_PHRASES = [
  "\u043d\u0430 \u044d\u0442\u043e\u043c \u0441\u043b\u0430\u0439\u0434\u0435",
  "\u044d\u0442\u043e\u0442 \u0441\u043b\u0430\u0439\u0434",
  "\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u0440\u0430\u0441\u043a\u0440\u044b\u0432\u0430\u0435\u0442\u0441\u044f",
  "\u0437\u0430\u0434\u0430\u044e\u0442 \u043b\u043e\u0433\u0438\u043a\u0443 \u043e\u0431\u044a\u044f\u0441\u043d\u0435\u043d\u0438\u044f",
  "\u043b\u043e\u0433\u0438\u043a\u0430 \u043e\u0431\u044a\u044f\u0441\u043d\u0435\u043d\u0438\u044f",
  "\u0441\u0432\u044f\u0437\u044c \u043c\u0435\u0436\u0434\u0443 \u0444\u0430\u043a\u0442\u0430\u043c\u0438",
  "\u0434\u0435\u043b\u0430\u0435\u0442 \u0442\u0435\u043c\u0443 \u043f\u043e\u043d\u044f\u0442\u043d\u0435\u0435",
  "\u043f\u043e\u043c\u043e\u0433\u0430\u0435\u0442 \u043e\u0431\u044a\u044f\u0441\u043d\u0438\u0442\u044c",
  "\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0441\u044f \u0441\u043c\u044b\u0441\u043b\u043e\u043c",
  "\u0433\u043b\u0430\u0432\u043d\u0430\u044f \u0438\u0434\u0435\u044f \u0441\u0432\u044f\u0437\u0430\u043d\u0430",
  "\u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442, \u043f\u0440\u0438\u0447\u0438\u043d\u044b \u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u0441\u0442\u0432\u0438\u044f",
  "\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0440\u0430\u0437\u0434\u0435\u043b",
  "\u043f\u0435\u0440\u0435\u0445\u043e\u0434",
  "\u043e\u043f\u043e\u0440\u043d\u044b\u0435 \u043f\u0443\u043d\u043a\u0442\u044b",
  "\u0433\u043b\u0430\u0432\u043d\u0430\u044f \u043c\u044b\u0441\u043b\u044c",
  "\u043e\u0431\u0449\u0430\u044f \u043c\u044b\u0441\u043b\u044c",
  "\u043f\u0440\u0438\u043c\u0435\u0440 \u043d\u0443\u0436\u0435\u043d",
  "\u0432\u0441\u044f \u0438\u0441\u0442\u043e\u0440\u0438\u044f \u0442\u0435\u043c\u044b",
  "\u0442\u0435\u043a\u0441\u0442 \u043d\u0430 \u0441\u043b\u0430\u0439\u0434\u0435",
];

const GENERIC_EXPLANATION_FILLER_PATTERNS = [
  /(?:главн[\p{L}\p{N}_]*\s+)?(?:фактор[\p{L}\p{N}_]*|факт[\p{L}\p{N}_]*|детал[\p{L}\p{N}_]+)\s+(?:зада[её]т|задают|стро[\p{L}\p{N}_]+|формир[\p{L}\p{N}_]+)\s+логик[\p{L}\p{N}_]+\s+объяснен[\p{L}\p{N}_]*/iu,
  /(?:связь\s+между\s+)?(?:факт[\p{L}\p{N}_]+|детал[\p{L}\p{N}_]+|фактор[\p{L}\p{N}_]+)\s+дела[\p{L}\p{N}_]+\s+(?:тем[\p{L}\p{N}_]+|материал|объяснен[\p{L}\p{N}_]+)\s+понятн[\p{L}\p{N}_]*/iu,
  /(?:помога[\p{L}\p{N}_]+|позволя[\p{L}\p{N}_]+)\s+объясн[\p{L}\p{N}_]+/iu,
  /станов[\p{L}\p{N}_]+\s+(?:главн[\p{L}\p{N}_]*\s+)?смысл[\p{L}\p{N}_]+/iu,
  /важн[\p{L}\p{N}_]+\s+для\s+понимания\s+тем[\p{L}\p{N}_]+/iu,
];

const GENERIC_TITLE_PHRASES = [
  "\u0432\u0432\u0435\u0434\u0435\u043d\u0438\u0435",
  "\u043e\u0441\u043d\u043e\u0432\u043d\u044b\u0435 \u0444\u0430\u043a\u0442\u044b",
  "\u043a\u043b\u044e\u0447\u0435\u0432\u044b\u0435 \u043f\u043e\u043d\u044f\u0442\u0438\u044f",
  "\u043f\u0440\u0438\u043c\u0435\u0440\u044b",
  "\u0432\u044b\u0432\u043e\u0434\u044b",
  "\u0438\u0442\u043e\u0433\u0438",
];

export function isGenericTitle(title: string) {
  const normalized = normalizeQualityText(title);
  if (!normalized) return true;
  return GENERIC_TITLE_PHRASES.includes(normalized)
    || /^(?:slide|section|part)\s+\d+$/i.test(title.trim())
    || /^(?:слайд|раздел|часть)\s+\d+$/iu.test(title.trim());
}

export function hasMetaSlideLanguage(text: string) {
  const normalized = normalizeQualityText(text);
  return BANNED_QUALITY_PHRASES.some((phrase) => normalized.includes(normalizeQualityText(phrase)))
    || GENERIC_EXPLANATION_FILLER_PATTERNS.some((pattern) => pattern.test(text))
    || /(?:^|[^\p{L}])главн(?:ая|ую|ой)\s+мысл/iu.test(text)
    || /(?:^|[^\p{L}])общ(?:ая|ую|ей)\s+мысл/iu.test(text)
    || /(?:^|[^\p{L}])пример\s+нужен/iu.test(text)
    || /(?:^|[^\p{L}])вс[яю]\s+истори[яю]\s+темы/iu.test(text)
    || /(?:на|в)\s+этом\s+слайде|этот\s+слайд|текст\s+на\s+слайде|заметк[аи]\s+докладчика/iu.test(text)
    || /(?:этот|следующий|данный)\s+раздел|следующ(?:ая|ий)\s+(?:часть|фрагмент)/iu.test(text)
    || /переход\s+(?:к|дальше)|готовит\s+переход|подводит\s+(?:рассказ\s+)?к\s+следующ/iu.test(text)
    || /\b(?:slide|section|next section|on this slide)\b/i.test(text);
}

export function hasRepeatedSentenceStart(texts: string[]) {
  const starts = texts
    .flatMap((text) => sentenceStarts(text))
    .filter(Boolean);
  const counts = new Map<string, number>();
  starts.forEach((start) => counts.set(start, (counts.get(start) || 0) + 1));
  return [...counts.values()].some((count) => count >= 3);
}

export function hasUnsupportedSpecificity(text: string, sources: Source[]) {
  if (!hasPreciseFact(text)) return false;
  if (!sources.length) return true;
  const sourceText = normalizeQualityText(sources.map((source) => `${source.label} ${source.excerpt}`).join(" "));
  const facts = text.match(/\d{4}|\d{1,3}(?:[.,]\d+)?\s*(?:%|\u043c\u043b\u043d|\u043c\u043b\u0440\u0434|\u043b\u0435\u0442|\u0433\u043e\u0434(?:\u0430|\u043e\u0432)?)/giu) || [];
  return facts.some((fact) => !sourceText.includes(normalizeQualityText(fact)));
}

function factualSlideText(slide: Slide) {
  return [
    slide.title,
    slide.thesis,
    ...slide.bullets,
    ...slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : [block.content]),
    slide.definition?.term,
    slide.definition?.text,
    slide.visual.title,
    slide.visual.description,
    ...slide.visual.items.flatMap((item) => [item.label, item.text]),
    ...slide.visual.rows.flatMap((row) => [row.label, row.left, row.right]),
  ].filter(Boolean).join(" ");
}

function factualClaimText(slide: Slide) {
  return [
    slide.thesis,
    ...slide.bullets,
    ...slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : [block.content]),
    slide.definition?.text,
  ].filter(Boolean).join(" ");
}

function hasHighRiskClaim(text: string) {
  if (hasPreciseFact(text)) return true;
  const namedEntity = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/u.test(text);
  const historicalEvent = /\b(?:war|revolution|treaty|crisis|election|войн[аы]|революци[яи]|договор|кризис|выборы)\b/iu.test(text);
  const causal = /\b(?:because|therefore|causes?|leads?\s+to|results?\s+in|потому\s+что|приводит\s+к|вызывает|стало\s+причиной)\b/iu.test(text);
  const comparative = /\b(?:most|least|best|largest|first|superior|наиболее|сам(?:ый|ая|ое|ые)|лучше|крупнейш)\b/iu.test(text);
  return historicalEvent || comparative || (namedEntity && causal);
}

function matchingSourceForSlide(slide: Slide, sources: Source[]) {
  const text = factualSlideText(slide);
  const byId = new Map(sources.map((source) => [source.id, source]));
  return slide.sourceRefs.some((reference) => {
    const source = byId.get(reference.sourceId);
    return Boolean(source && sourceSupportsClaim(text, source, reference.excerpt));
  });
}

function sourceSupportsClaim(claim: string, source: Source, referenceExcerpt = "") {
  const sourceText = normalizeQualityText([source.label, source.excerpt, source.url, referenceExcerpt].filter(Boolean).join(" "));
  if (!sourceText) return false;
  const preciseValues = claim.match(/\b(?:\d{4}|\d{1,3}(?:[.,]\d+)?\s*(?:%|млн|млрд|лет|года|годов))\b/giu) || [];
  if (preciseValues.length) return preciseValues.every((value) => sourceText.includes(normalizeQualityText(value)));
  const claimTerms = normalizeQualityText(claim)
    .match(/[\p{L}\p{N}]{4,}/gu)?.filter((term) => !SOURCE_MATCH_STOP_WORDS.has(term)) || [];
  const overlap = new Set(claimTerms.filter((term) => sourceText.includes(term)));
  return overlap.size >= 2;
}

function generalizeSlideClaims(slide: Slide): Slide {
  const generalize = (value: string) => generalizeUnsupportedClaim(value);
  return {
    ...slide,
    // The title is the deck's thematic anchor, not a standalone factual
    // assertion. Keep it intact while generalizing unsupported body claims.
    title: slide.title,
    thesis: generalize(slide.thesis),
    bullets: slide.bullets.map(generalize),
    blocks: slide.blocks.map((block) => block.type === "bullets"
      ? { ...block, items: block.items.map(generalize) }
      : { ...block, content: generalize(block.content) }),
    definition: slide.definition ? { term: generalize(slide.definition.term), text: generalize(slide.definition.text) } : null,
    visual: {
      ...slide.visual,
      title: generalize(slide.visual.title),
      description: generalize(slide.visual.description),
      items: slide.visual.items.map((item) => ({ ...item, label: generalize(item.label), text: generalize(item.text) })),
      rows: slide.visual.rows.map((row) => ({ ...row, label: generalize(row.label), left: generalize(row.left), right: generalize(row.right) })),
    },
  };
}

function generalizeUnsupportedClaim(value: string) {
  return cleanText(value)
    .replace(/\b(?:18|19|20)\d{2}\b/g, "в рассматриваемый период")
    .replace(/\b\d{1,3}(?:[.,]\d+)?\s*%/g, "заметно")
    .replace(/\b\d{1,3}(?:[.,]\d+)?\s*(?:млн|млрд|лет|года|годов)\b/giu, "несколько")
    .replace(/\b(?:most|least|best|largest|first|superior)\b/giu, "notable")
    .replace(/\b(?:наиболее|сам(?:ый|ая|ое|ые)|лучше|крупнейш\w*)\b/giu, "важный")
    .replace(/\b(?:because|therefore|causes?|leads?\s+to|results?\s+in)\b/giu, "is associated with")
    .replace(/\b(?:потому\s+что|приводит\s+к|вызывает|стало\s+причиной)\b/giu, "связан с");
}

const SOURCE_MATCH_STOP_WORDS = new Set([
  "about", "after", "before", "their", "there", "which", "these", "those", "этого", "также", "после", "среди", "когда", "который", "которые", "может", "важный",
]);

export function hasWeakConclusion(slide: Slide, project: QualityProjectInput) {
  if (slide.order !== project.slideCount && slide.slideKind !== "summary") return false;
  return inspectConclusion(slide, project).weak;
}

export function scoreSpeechNaturalness(presentation: PresentationDocument): QualityDimensionScore {
  let penalty = 0;
  const shortNotes = presentation.slides.filter((slide) => wordCount(slide.speakerNotes) < 35).length;
  const metaNotes = presentation.slides.filter((slide) => hasMetaSlideLanguage(slide.speakerNotes)).length;
  const missingScripts = presentation.slides.filter((slide) => {
    const script = presentation.speechScript.find((item) => item.slideOrder === slide.order);
    return !script || wordCount(script.text) < 35;
  }).length;
  penalty += ratioPenalty(shortNotes, presentation.slides.length, 30);
  penalty += ratioPenalty(metaNotes, presentation.slides.length, 35);
  penalty += ratioPenalty(missingScripts, presentation.slides.length, 20);
  if (hasRepeatedSentenceStart(presentation.slides.map((slide) => slide.speakerNotes))) penalty += 15;
  const score = clamp(Math.round(100 - penalty), 0, 100);
  return dimension(score, score >= 85
    ? "Speaker notes are complete, direct, and varied enough to read aloud."
    : "Speaker notes need fuller, less repetitive, more natural spoken phrasing.");
}

export function scoreUniversityTone(
  presentation: PresentationDocument,
  project?: QualityProjectInput,
): QualityDimensionScore {
  const text = [
    presentation.title,
    presentation.scenario,
    presentation.level,
    project?.scenario,
    project?.level,
    ...presentation.slides.flatMap((slide) => [slide.title, slide.thesis, ...slide.bullets, slide.speakerNotes]),
  ].filter(Boolean).join(" ");
  const childishMatches = CHILDISH_OR_SCHOOL_COPY.filter((pattern) => pattern.test(text)).length;
  const academicSignals = /(?:университет|вуз|семинар|исследован|анализ|аргумент|university|seminar|research|analysis)/iu.test(text);
  const score = clamp(100 - childishMatches * 25 - (childishMatches > 0 && !academicSignals ? 10 : 0), 0, 100);
  return dimension(score, score >= 85
    ? "The language fits a university student presentation."
    : "School-oriented or childish wording weakens the university-level tone.");
}

export function scoreSlideBrevity(presentation: PresentationDocument): QualityDimensionScore {
  const denseSlides = presentation.slides.filter(isVisibleTextTooLong).length;
  const crowdedSlides = presentation.slides.filter((slide) => slide.bullets.length > 4 || slide.blocks.length > 3).length;
  const score = clamp(100
    - ratioPenalty(denseSlides, presentation.slides.length, 65)
    - ratioPenalty(crowdedSlides, presentation.slides.length, 20), 0, 100);
  return dimension(Math.round(score), score >= 85
    ? "Titles, theses, and supporting text stay concise."
    : "Visible slide copy is too dense for a speech-first deck.");
}

export function scoreVisualRhythm(presentation: PresentationDocument): QualityDimensionScore {
  const layoutIssues = findLayoutRhythmIssues(presentation).length;
  const visualPlanIssues = findVisualPlanIssues(presentation).length;
  const textOnlySlides = presentation.slides.filter((slide) =>
    slide.visual.type === "none" || (!slide.visual.description && !slide.visual.image && !slide.visual.items.length && !slide.visual.rows.length),
  ).length;
  const layouts = new Set(presentation.slides.map((slide) => slide.layout)).size;
  let penalty = Math.min(40, layoutIssues * 12 + visualPlanIssues * 9);
  penalty += ratioPenalty(textOnlySlides, presentation.slides.length, 35);
  if (presentation.slides.length >= 4 && layouts < 3) penalty += 15;
  const score = clamp(Math.round(100 - penalty), 0, 100);
  return dimension(score, score >= 85
    ? "Layouts and visual roles create an intentional rhythm."
    : "The deck repeats layouts or relies too heavily on text-only slides.");
}

export function scoreSourceGrounding(
  presentation: PresentationDocument,
  sources: Source[] = presentation.sources,
): QualityDimensionScore {
  const unsupported = findFactualRiskIssues(presentation, sources).length;
  const preciseSlides = presentation.slides.filter((slide) =>
    hasHighRiskClaim(factualClaimText(slide)),
  ).length;
  const unreferenced = unsupported;
  const denominator = Math.max(1, preciseSlides);
  const score = clamp(Math.round(100
    - ratioPenalty(unsupported, denominator, 65)
    - ratioPenalty(unreferenced, denominator, 20)), 0, 100);
  return dimension(score, score >= 85
    ? "Specific claims are sufficiently supported or appropriately general."
    : "Precise claims need source support or safer general wording.");
}

export function scoreExportReadiness(presentation: PresentationDocument): QualityDimensionScore {
  let riskySlides = 0;
  for (const slide of presentation.slides) {
    const canvas = slide.canvas;
    if (!canvas || !canvas.elements.length) {
      riskySlides += 1;
      continue;
    }
    const invalid = auditSlideCanvas(canvas).length > 0 || canvas.elements.some((element) =>
      element.type === "image" && !element.objectKey,
    );
    if (invalid) riskySlides += 1;
  }
  const score = clamp(Math.round(100 - ratioPenalty(riskySlides, presentation.slides.length, 70)), 0, 100);
  return dimension(score, score >= 85
    ? "Slide canvases are complete and safe for web, PPTX, and PDF export."
    : "One or more slides need a rebuilt canvas or corrected export elements.");
}

export function findGenericTextIssues(presentation: PresentationDocument): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const entry of collectSlideTextEntries(presentation)) {
    const normalized = normalizeQualityText(entry.value);
    if (!normalized) continue;
    const banned = hasMetaSlideLanguage(entry.value);
    const genericTitle = entry.field === "title" && isGenericTitle(entry.value);
    if (!banned && !genericTitle) continue;

    issues.push({
      slideId: entry.slide.id,
      severity: entry.field === "title" || entry.field === "thesis" ? "major" : "minor",
      category: "generic_text",
      field: entry.field,
      message: banned ? "Generic or meta phrase detected." : "Generic slide title detected.",
      repairInstruction: "Replace with a topic-specific, human phrase grounded in the slide narration.",
    });
  }
  return issues;
}

/**
 * Checks the text that a listener can actually see in each independent layout
 * slot. Labels are intentionally treated differently from propositions: a
 * label such as "1963" or "Carrera RS" is valid without a final stop, while a
 * thesis, bullet, block or visual explanation must stand on its own.
 */
export function findVisibleTextIntegrityIssues(presentation: PresentationDocument): QualityIssue[] {
  return presentation.slides.flatMap((slide) => visibleTextIntegrityEntries(slide).flatMap((entry) => {
    const reason = visibleTextIntegrityReason(entry.value, entry.label);
    if (!reason) return [];
    return [{
      slideId: slide.id,
      severity: entry.label ? "minor" as const : "major" as const,
      category: "generic_text" as const,
      field: entry.field,
      message: `Visible text is incomplete: ${reason}.`,
      repairInstruction: "Replace this field with one complete, self-contained formulation from the accepted narration. Do not continue a sentence from another layout slot.",
    }];
  }));
}

/** Content slides may project one claim and zero to three support points from accepted speech. */
export function findContentSlideContractIssues(presentation: PresentationDocument): QualityIssue[] {
  return presentation.slides.flatMap((slide) => {
    if (slide.slideKind !== "content" || contentSlideExceptionReason(slide)) return [];
    const usefulBullets = slide.bullets.filter((bullet) =>
      !visibleTextIntegrityReason(bullet, false)
      && normalizedMessage(bullet) !== normalizedMessage(slide.thesis)
      && semanticOverlap(bullet, slide.thesis) < 0.8,
    );
    const issues: QualityIssue[] = [];
    if (visibleTextIntegrityReason(slide.thesis, false) || hasMetaSlideLanguage(slide.thesis)) {
      issues.push({ slideId: slide.id, severity: "major", category: "generic_text", field: "thesis", message: "Content slide must contain one complete, topic-specific thesis.", repairInstruction: "Project the first complete claim from accepted narration into the thesis without changing the narration." });
    }
    if (usefulBullets.length > 3) {
      issues.push({ slideId: slide.id, severity: "major", category: "generic_text", field: "contentContract", message: "Content slide must contain at most three distinct support points.", repairInstruction: "Keep only the strongest distinct support points from accepted narration; do not invent facts." });
    }
    return issues;
  });
}

export function contentSlideExceptionReason(slide: Slide): string | null {
  if (slide.layout === "quote" && slide.blocks.some((block) => block.type === "quote" && !visibleTextIntegrityReason(block.content, false))) return "a complete central quotation is the slide's evidence";
  const diagramTypes = new Set(["process_diagram", "comparison_diagram", "cause_effect_diagram", "timeline", "mind_map", "schema"]);
  if (diagramTypes.has(slide.visual.type) && (slide.visual.diagram || slide.visual.graph || slide.visual.items.length >= 2 || slide.visual.rows.length >= 2)) return "a structured explanatory diagram carries the support points";
  return null;
}

/** Detects safe, exact repetitions inside one slide before they escape into export. */
export function findIntraSlideDuplicateIssues(presentation: PresentationDocument): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const slide of presentation.slides) {
    const seen: Array<{ field: string; value: string }> = [];
    for (const entry of visibleTextIntegrityEntries(slide).filter((candidate) =>
      // Keep one-word structural labels out of prose duplicate detection, but
      // include the slide title and visual title as semantic text anchors.
      !candidate.label || candidate.field === "title" || candidate.field === "visual.title",
    )) {
      const key = normalizedMessage(entry.value);
      if (!key || key.length < 8) continue;
      const duplicateOf = seen.find((candidate) => {
        // A title is a normal prefix of a callout or a thesis. Treat it as a
        // duplicate only when the entire text is the same, not when the
        // longer sentence explains that title.
        if ((entry.field === "title" || candidate.field === "title")
          && normalizedMessage(entry.value) !== normalizedMessage(candidate.value)) return false;
        return semanticallyRepeats(entry.value, candidate.value);
      });
      if (!duplicateOf) {
        seen.push({ field: entry.field, value: entry.value });
        continue;
      }
      issues.push({
        slideId: slide.id,
        severity: slide.slideKind !== "content" && /^bullets\.\d+$/u.test(entry.field) && duplicateOf.field === "thesis"
          ? "minor"
          : "major",
        category: "duplicate",
        field: entry.field,
        message: `Visible text duplicates ${duplicateOf.field} on the same slide.`,
        repairInstruction: "Remove the repeated or paraphrased text. If the layout needs another point, derive a distinct short point from the accepted narration without adding unsupported facts.",
      });
    }
  }
  return issues;
}

/**
 * Finds repeated central messages anywhere in the deck, not only on adjacent
 * slides. Topic anchors that occur on most slides are removed first so a
 * repeated subject name alone does not create a false positive.
 */
export function findDeckWideDuplicateIssues(presentation: PresentationDocument): QualityIssue[] {
  const signatures = presentation.slides.map((slide) => ({
    slide,
    central: normalizedMessage(slide.thesis),
    tokens: deckMessageTokens(slide),
  }));
  const frequency = new Map<string, number>();
  signatures.forEach(({ tokens }) => new Set(tokens).forEach((token) => frequency.set(token, (frequency.get(token) || 0) + 1)));
  const anchorLimit = Math.ceil(presentation.slides.length * 0.6);
  const filtered = signatures.map((signature) => ({
    ...signature,
    tokens: signature.tokens.filter((token) => (frequency.get(token) || 0) < anchorLimit),
  }));
  const issues: QualityIssue[] = [];

  for (let leftIndex = 0; leftIndex < filtered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < filtered.length; rightIndex += 1) {
      const left = filtered[leftIndex];
      const right = filtered[rightIndex];
      const sameCentralClaim = left.central.length >= 18 && left.central === right.central;
      const centralTokens = uniqueTokens(topicTokens(left.central));
      const rightCentralTokens = uniqueTokens(topicTokens(right.central));
      const semanticallySameCentralClaim = left.central.length >= 18
        && right.central.length >= 18
        && centralTokens.length >= 5
        && rightCentralTokens.length >= 5
        && semanticOverlap(left.central, right.central) >= 0.82;
      const centralJaccard = jaccardSimilarity(centralTokens, rightCentralTokens);
      const semanticCentralRepeat = semanticallySameCentralClaim && centralJaccard >= 0.72;
      const similarity = jaccardSimilarity(left.tokens, right.tokens);
      const intersection = left.tokens.filter((token) => right.tokens.includes(token)).length;
      if (!sameCentralClaim && !semanticCentralRepeat && !(left.tokens.length >= 6 && right.tokens.length >= 6 && similarity >= 0.9 && intersection >= 5)) continue;
      issues.push({
        slideId: right.slide.id,
        severity: sameCentralClaim || similarity >= 0.9 ? "blocker" : "major",
        category: "duplicate",
        field: "keyMessage",
        message: `Slide ${right.slide.order} repeats the central message of slide ${left.slide.order}.`,
        repairInstruction: "Replace the repeated central claim only with a distinct example, cause, consequence, stage, or conclusion from this slide's accepted narration. Preserve sourceRefs and do not invent facts.",
      });
    }
  }
  return issues;
}

/**
 * Builds a compact, local-only topic vocabulary. It deliberately combines the
 * project request with the already accepted narration and story plan, so a
 * generic word such as "conflict" is never treated as globally forbidden.
 */
export function buildTopicProfile(presentation: PresentationDocument, project: QualityProjectInput): TopicProfile {
  const brief = project.generationBrief && typeof project.generationBrief === "object" ? project.generationBrief as Record<string, unknown> : {};
  const research = project.researchBrief && typeof project.researchBrief === "object" ? project.researchBrief as Record<string, unknown> : {};
  const projectText = [
    project.title,
    project.prompt,
    ...pickBriefText(brief, ["topic", "angle", "audience", "goal", "vocabulary", "keywords"]),
    ...pickBriefText(research, ["topic", "angle", "vocabulary"]),
  ].join(" ");
  const narrativeText = presentation.narrativePlan.flatMap((item) => [item.slideTitle, item.keyMessage, item.slidePurpose]).join(" ");
  const sourceText = presentation.sources.flatMap((source) => [source.label, String(source.excerpt || "").slice(0, 240)]).join(" ");
  const projectTokens = topicTokens(projectText);
  const narrativeTokens = topicTokens(narrativeText);
  const sourceTokens = topicTokens(sourceText);
  const tokens = uniqueTokens([...projectTokens, ...narrativeTokens, ...sourceTokens]);
  const anchors = uniqueTokens([...projectTokens, ...narrativeTokens]).slice(0, 36);
  const allowedEntities = [...new Set([...
    projectText.match(/(?:BMW\s+(?:M|\d{1,3})|[A-ZА-ЯЁ][\p{L}\p{N}-]+(?:\s+[A-ZА-ЯЁ][\p{L}\p{N}-]+){0,2})/gu) || [],
    ...sourceText.match(/(?:BMW\s+(?:M|\d{1,3})|[A-ZА-ЯЁ][\p{L}\p{N}-]+(?:\s+[A-ZА-ЯЁ][\p{L}\p{N}-]+){0,2})/gu) || [],
  ])].map(cleanText).filter(Boolean).slice(0, 24);
  const years = [projectText, narrativeText, sourceText].join(" ").match(/\b(?:18|19|20)\d{2}\b/g) || [];
  const finalAnchors = anchors.length ? anchors : tokens.slice(0, 20);
  return {
    tokens,
    anchors: finalAnchors,
    allowedEntities,
    timeRange: years.length ? `${years[0]}${years.length > 1 ? `–${years.at(-1)}` : ""}` : "",
    domainAnchors: [...new Set([...finalAnchors, ...allowedEntities])].slice(0, 24),
  };
}

/**
 * Detects a substantial mismatch between visible text and the accepted speech
 * for the same slide. This is intentionally contextual: a deck about a
 * conflict supplies conflict-related anchors itself and therefore does not
 * trigger merely because it contains words such as "crisis" or "negotiation".
 */
export function findTopicRelevanceIssues(
  presentation: PresentationDocument,
  project: QualityProjectInput,
): QualityIssue[] {
  const profile = buildTopicProfile(presentation, project);
  if (profile.anchors.length < 2) return [];

  return presentation.slides.flatMap((slide) => {
    const visible = visibleSlideText(slide);
    const visibleTokens = uniqueTokens(topicTokens(visible));
    // Short title and transition slides do not carry enough semantic evidence.
    if (visibleTokens.length < 7) return [];

    const script = presentation.speechScript.find((item) => item.slideOrder === slide.order)?.text || "";
    const narrative = presentation.narrativePlan.find((item) => item.slideOrder === slide.order);
    const acceptedContext = [slide.speakerNotes, script, narrative?.slideTitle, narrative?.keyMessage, narrative?.slidePurpose].join(" ");
    const contextTokens = uniqueTokens(topicTokens(acceptedContext));
    const anchorMatches = overlapCount(visibleTokens, profile.anchors);
    const contextMatches = overlapCount(visibleTokens, contextTokens);
    const unmatched = visibleTokens.filter((token) => !matchesAny(token, profile.anchors) && !matchesAny(token, contextTokens));
    const foreignSignals = foreignDomainSignalCount(visible);
    // One or two topic echoes (for example, a deck title prepended to a
    // pasted paragraph) are not enough to make a long foreign passage valid.
    const hasStrongMismatch = (anchorMatches <= 2
      && contextMatches <= 2
      && unmatched.length >= 5
      && (foreignSignals >= 2 || (profile.anchors.length >= 5 && visibleTokens.length >= 10)))
      || (foreignSignals >= 3 && anchorMatches <= 4 && unmatched.length >= 5);

    if (!hasStrongMismatch) return [];
    return [{
      slideId: slide.id,
      severity: "major" as const,
      category: "off_topic" as const,
      field: "visibleText",
      message: "Visible slide text diverges from the project topic and accepted narration.",
      repairInstruction: "Rewrite every visible field only from the matching accepted narration section. Keep speakerNotes and speechScript unchanged.",
    }];
  });
}

/** Visual queries are content, too: a foreign scene can derail image search even when slide copy is correct. */
export function findOffTopicVisualIssues(presentation: PresentationDocument, project: QualityProjectInput): QualityIssue[] {
  const profile = buildTopicProfile(presentation, project);
  return presentation.slides.flatMap((slide) => {
    const visualText = [slide.visual.description, presentation.designBrief?.slideDirections.find((item) => item.slideOrder === slide.order)?.visualPrompt]
      .filter(Boolean)
      .join(" ");
    if (!visualText || foreignDomainSignalCount(visualText) < 2) return [];
    const visualTokens = uniqueTokens(topicTokens(visualText));
    if (overlapCount(visualTokens, profile.domainAnchors) > 2) return [];
    return [{
      slideId: slide.id,
      severity: "major" as const,
      category: "off_topic" as const,
      field: "visual.description",
      message: "Visual prompt diverges from the project topic and slide story job.",
      repairInstruction: "Replace the visual prompt with a concrete scene or explanatory diagram for this slide's accepted narration; do not introduce a foreign domain.",
    }];
  });
}

/** Specific model-family substitutions are factual category errors, not harmless wording variants. */
export function findEntityCategoryMismatchIssues(presentation: PresentationDocument): QualityIssue[] {
  const mismatch = /\bBMW\s*328\b[^.!?\n]{0,80}\b(?:BMW\s*M|M[-\s]?модел[ьяеи]?|M model)\b|\b(?:BMW\s*M|M[-\s]?модел[ьяеи]?|M model)\b[^.!?\n]{0,80}\bBMW\s*328\b/iu;
  return presentation.slides.flatMap((slide) => mismatch.test(factualSlideText(slide)) ? [{
    slideId: slide.id,
    severity: "blocker" as const,
    category: "factual_risk" as const,
    field: "visibleText",
    message: "BMW 328 is incorrectly classified as a BMW M model.",
    repairInstruction: "State only that BMW 328 is an early BMW model, or use a supported source-backed formulation. Do not attach an unrelated sourceRef.",
  }] : []);
}

/**
 * Makes the accepted narration explicit at the same seam as the generated
 * slide content.  It deliberately reads generatedText first: notes and the
 * script are projections of accepted narration, not competing authorities.
 */
export function buildSlideSemanticContracts(presentation: PresentationDocument): SlideSemanticContract[] {
  const acceptedByOrder = new Map(parseAcceptedNarrationSections(presentation.generatedText)
    .map((section) => [section.order, section]));
  const scriptsByOrder = new Map<number, typeof presentation.speechScript>();
  for (const item of presentation.speechScript) {
    const items = scriptsByOrder.get(item.slideOrder) || [];
    items.push(item);
    scriptsByOrder.set(item.slideOrder, items);
  }

  return presentation.slides.map((slide) => {
    const narrative = presentation.narrativePlan.find((item) => item.slideOrder === slide.order);
    const accepted = acceptedByOrder.get(slide.order);
    const scripts = scriptsByOrder.get(slide.order) || [];
    return {
      slideOrder: slide.order,
      narrativeTitle: narrative?.slideTitle || accepted?.title || slide.title,
      keyMessage: narrative?.keyMessage || "",
      acceptedNarration: accepted?.text || "",
      speakerNotes: slide.speakerNotes,
      speechScript: scripts.length === 1 ? scripts[0].text : "",
      visibleText: visibleSlideText(slide),
    };
  });
}

export function scoreSlideSpeechAlignment(contract: SlideSemanticContract): SlideSpeechAlignmentScore {
  const visibleToAccepted = semanticOverlap(contract.visibleText, contract.acceptedNarration);
  const visibleToKeyMessage = semanticOverlap(contract.visibleText, contract.keyMessage);
  const notesToScript = semanticOverlap(contract.speakerNotes, contract.speechScript);
  const notesToAccepted = semanticOverlap(contract.speakerNotes, contract.acceptedNarration);
  const scriptToAccepted = semanticOverlap(contract.speechScript, contract.acceptedNarration);
  const coverage = [visibleToAccepted, visibleToKeyMessage, notesToScript, notesToAccepted, scriptToAccepted]
    .filter((value) => Number.isFinite(value));
  return {
    slideOrder: contract.slideOrder,
    score: coverage.length ? Math.round(coverage.reduce((total, value) => total + value, 0) / coverage.length * 100) : 0,
    visibleToAccepted,
    visibleToKeyMessage,
    notesToScript,
    notesToAccepted,
    scriptToAccepted,
    hasMatchingScript: Boolean(contract.speechScript.trim()),
  };
}

/**
 * Finds only consequential mismatches.  A compact title may use a synonym
 * or omit most narration words, so it is not rejected unless the visible
 * content has essentially no shared anchors or carries a foreign domain.
 */
export function findSlideSpeechAlignmentIssues(presentation: PresentationDocument): QualityIssue[] {
  const contracts = buildSlideSemanticContracts(presentation);
  const scriptsByOrder = new Map<number, typeof presentation.speechScript>();
  for (const item of presentation.speechScript) {
    const items = scriptsByOrder.get(item.slideOrder) || [];
    items.push(item);
    scriptsByOrder.set(item.slideOrder, items);
  }

  return contracts.flatMap((contract) => {
    const slide = presentation.slides.find((candidate) => candidate.order === contract.slideOrder)!;
    const scripts = scriptsByOrder.get(contract.slideOrder) || [];
    const score = scoreSlideSpeechAlignment(contract);
    const issues: QualityIssue[] = [];
    const isContentSlide = slide.slideKind !== "title" && slide.slideKind !== "summary";
    const matchingTitle = scripts.length === 1 && scripts[0].slideTitle === slide.title;

    if (scripts.length !== 1 || !matchingTitle || (isContentSlide && (!contract.acceptedNarration.trim() || !contract.speakerNotes.trim() || !contract.speechScript.trim()))) {
      issues.push({
        slideId: slide.id,
        severity: "major",
        category: "bad_narration",
        field: "speechScript",
        message: "The slide must have one ordered speech-script item with the current slide title and accepted narration.",
        repairInstruction: "Restore speaker notes and the speech-script item from accepted generated narration for this slide order.",
      });
    }

    const visibleTokens = uniqueTokens(topicTokens(contract.visibleText));
    // The accepted section for this exact slide order is the only textual
    // donor for visible copy. Narrative metadata can remain useful for
    // diagnostics, but must never turn an unsupported screen claim into a
    // covered one.
    const acceptedTokens = uniqueTokens(topicTokens(contract.acceptedNarration));
    const visibleCoverage = score.visibleToAccepted;
    const softThreshold = slide.slideKind === "title" || slide.slideKind === "summary" ? 0.18 : 0.34;
    const hasForeignDomain = foreignDomainSignalCount(contract.visibleText) >= 2;
    const lacksSharedAnchors = visibleTokens.length >= 7 && acceptedTokens.length >= 4 && visibleCoverage < softThreshold;
    if (lacksSharedAnchors && (hasForeignDomain || visibleCoverage < 0.2)) {
      issues.push({
        slideId: slide.id,
        severity: "major",
        category: "off_topic",
        field: "visibleText",
        message: "Visible slide text does not express the accepted narration for the same slide order.",
        repairInstruction: "Rewrite only visible slide fields from the accepted narration; keep accepted narration unchanged.",
      });
    }
    const visibleFields = visibleTextIntegrityEntries(slide)
      .filter((entry) => !entry.label && entry.value.trim());
    const lacksConcreteSupport = visibleFields.length > 0 && visibleFields.every((entry) =>
      hasGenericOrMetaScreenText(entry.value)
      || semanticOverlap(entry.value, contract.acceptedNarration) < 0.18,
    );
    const hasUnsupportedGenericField = visibleFields.some((entry) =>
      isLowInformationProjection(entry.value),
    );
    if (lacksConcreteSupport || hasUnsupportedGenericField) {
      issues.push({
        slideId: slide.id,
        severity: "major",
        category: "generic_text",
        field: "visibleText",
        message: "Visible slide text has no concrete support in the accepted narration for this slide order.",
        repairInstruction: "Keep one supported thesis and only distinct concrete support points from this slide's accepted narration; omit unsupported bullets.",
      });
    }
    return issues;
  });
}

export function findRepeatedTitleIssues(presentation: PresentationDocument): QualityIssue[] {
  const counts = new Map<string, Slide[]>();
  presentation.slides.forEach((slide) => {
    const key = normalizeQualityText(slide.title);
    if (!key) return;
    counts.set(key, [...(counts.get(key) || []), slide]);
  });

  return [...counts.values()]
    .filter((slides) => slides.length > 1)
    .flatMap((slides) =>
      slides.map((slide) => ({
        slideId: slide.id,
        severity: "major" as const,
        category: "duplicate" as const,
        field: "title",
        message: `Slide title repeats ${slides.length} times.`,
        repairInstruction: "Give this slide its own topic-specific title that matches its speaker notes.",
      })),
    );
}

export function findNarrationMetaIssues(presentation: PresentationDocument): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const slide of presentation.slides) {
    const note = normalizeQualityText(slide.speakerNotes);
    const script = normalizeQualityText(presentation.speechScript.find((item) => item.slideOrder === slide.order)?.text || "");
    for (const [field, value] of [["speakerNotes", note], ["speechScript", script]] as const) {
      if (!value) continue;
      const banned = hasMetaSlideLanguage(value);
      if (!banned) continue;
      issues.push({
        slideId: slide.id,
        severity: "major",
        category: "bad_narration",
        field,
        message: "Narration contains meta or filler phrase.",
        repairInstruction: "Rewrite narration as direct topic explanation without mentioning the slide or transition mechanics.",
      });
    }
  }
  return issues;
}

export function findRepeatedSentenceStartIssues(presentation: PresentationDocument): QualityIssue[] {
  const notes = presentation.slides.map((slide) => slide.speakerNotes);
  if (!hasRepeatedSentenceStart(notes)) return [];
  return [{
    severity: "minor",
    category: "bad_narration",
    field: "speakerNotes",
    message: "Speaker notes repeat the same sentence opening too often.",
    repairInstruction: "Vary sentence openings while keeping the same factual meaning.",
  }];
}

export function findLayoutRhythmIssues(presentation: PresentationDocument): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (let index = 0; index < presentation.slides.length - 2; index += 1) {
    const run = presentation.slides.slice(index, index + 3);
    if (run.every((slide) => slide.layout === run[0].layout)) {
      issues.push({
        slideId: run[2].id,
        severity: "minor",
        category: "bad_visual",
        field: "layout",
        message: `Layout ${run[0].layout} repeats on three adjacent slides.`,
        repairInstruction: "Switch one affected slide to a layout that better matches its intent.",
      });
    }
  }

  const directions = presentation.designBrief?.slideDirections || [];
  for (let index = 0; index < directions.length - 2; index += 1) {
    const run = directions.slice(index, index + 3);
    if (run.every((direction) => direction.layoutIntent === run[0].layoutIntent)) {
      issues.push({
        slideId: presentation.slides.find((slide) => slide.order === run[2].slideOrder)?.id,
        severity: "minor",
        category: "bad_visual",
        field: "designBrief.slideDirections.layoutIntent",
        message: `Design layoutIntent ${run[0].layoutIntent} repeats on three adjacent slides.`,
        repairInstruction: "Change one affected design direction to create a stronger visual rhythm.",
      });
    }
    if (run[0].sceneTextMode && run.every((direction) => direction.sceneTextMode === run[0].sceneTextMode)) {
      issues.push({
        slideId: presentation.slides.find((slide) => slide.order === run[2].slideOrder)?.id,
        severity: "minor",
        category: "bad_visual",
        field: "designBrief.slideDirections.sceneTextMode",
        message: `Scene text mode ${run[0].sceneTextMode} repeats on three adjacent slides.`,
        repairInstruction: "Alternate phrase-led, talk, visual-label, and takeaway slide modes.",
      });
    }
  }

  const counts = new Map<string, number>();
  presentation.slides.forEach((slide) => counts.set(slide.layout, (counts.get(slide.layout) || 0) + 1));
  const limit = Math.ceil(presentation.slides.length * 0.6);
  for (const [layout, count] of counts.entries()) {
    if (presentation.slides.length >= 5 && count > limit) {
      issues.push({
        severity: "minor",
        category: "bad_visual",
        field: "layout",
        message: `Layout ${layout} is used on ${count} of ${presentation.slides.length} slides.`,
        repairInstruction: "Diversify layout rhythm while preserving slide meaning.",
      });
    }
  }
  return issues;
}

export function findVisualDescriptionIssues(presentation: PresentationDocument): QualityIssue[] {
  const slideIssues = presentation.slides.flatMap((slide) => {
    const description = normalizeQualityText(slide.visual.description);
    if (description && description.split(" ").length >= 4 && !BANNED_QUALITY_PHRASES.some((phrase) => description.includes(normalizeQualityText(phrase)))) {
      return [];
    }
    return [{
      slideId: slide.id,
      severity: slide.visual.type === "none" ? "minor" as const : "major" as const,
      category: "bad_visual" as const,
      field: "visual.description",
      message: "Visual description is missing, too generic, or not searchable.",
      repairInstruction: "Describe a concrete searchable visual tied to this slide topic.",
    }];
  });
  const designIssues = (presentation.designBrief?.slideDirections || []).flatMap((direction) => {
    if (direction.imageStrategy !== "real_photo" || !isGenericRealPhotoPrompt(direction.visualPrompt)) return [];
    return [{
      slideId: presentation.slides.find((slide) => slide.order === direction.slideOrder)?.id,
      severity: "major" as const,
      category: "bad_visual" as const,
      field: "designBrief.slideDirections.visualPrompt",
      message: "Realistic image prompt is generic instead of a concrete documentary subject.",
      repairInstruction: "Use a specific person, place, object, event, document, or environment, or switch imageStrategy to diagram/none.",
    }];
  });
  return [...slideIssues, ...designIssues];
}

/**
 * These checks use the post-enrichment document. A photo direction alone is
 * not coverage: it becomes coverage only after an image was actually kept.
 */
export function findVisualPlanIssues(presentation: PresentationDocument, project?: QualityProjectInput): QualityIssue[] {
  const contentSlides = presentation.slides.filter((slide) => slide.slideKind === "content");
  if (!contentSlides.length) return [];
  // A plain emergency-readable document deliberately has no design brief or
  // visual plan. There is no declared visual contract to enforce there, while
  // legacy image-asset diagnostics below remain available.
  const strictVisualPolicy = Boolean(presentation.designBrief)
    && isManagedSlideCount(project?.slideCount ?? presentation.slideCount)
    && presentation.productionQualityGate?.recoveryStage !== "emergency";
  const directionByOrder = new Map((presentation.designBrief?.slideDirections || []).map((direction) => [direction.slideOrder, direction]));
  // Managed counts use the new substantive-visual contract. Legacy counts
  // retain their historical non-none support semantics and allocation path.
  const hasVisualSupport = (slide: Slide) => strictVisualPolicy
    ? hasSubstantiveVisual(slide)
    : slide.visual.type !== "none" || Boolean(slide.visual.image);
  const issues: QualityIssue[] = [];
  const supported = contentSlides.filter(hasVisualSupport);

  if (strictVisualPolicy && contentSlides.length >= 3 && supported.length / contentSlides.length < 0.8) {
    issues.push({
      severity: "major",
      category: "bad_visual",
      field: "designBrief.slideDirections.imageStrategy",
      message: "Content-slide visual coverage is below the 80% target after image enrichment.",
      repairInstruction: "Convert the weakest text-led content directions to explanatory diagrams; do not insert an unrelated stock image.",
    });
  }

  for (const slide of strictVisualPolicy ? contentSlides : []) {
    const direction = directionByOrder.get(slide.order);
    if (direction?.imageStrategy !== "diagram" || hasSubstantiveVisual(slide)) continue;
    issues.push({
      slideId: slide.id,
      severity: "major",
      category: "bad_visual",
      field: "visual",
      message: "Planned diagram has no substantive visual payload.",
      repairInstruction: "Build a local diagram with at least two labeled nodes and a connection from the slide thesis and supporting points.",
    });
  }

  for (let index = 2; strictVisualPolicy && index < contentSlides.length; index += 1) {
    const run = contentSlides.slice(index - 2, index + 1);
    if (!run.every((slide) => !hasVisualSupport(slide))) continue;
    issues.push({
      slideId: run[2].id,
      severity: "major",
      category: "bad_visual",
      field: "designBrief.slideDirections.imageStrategy",
      message: "Three consecutive content slides are text-only.",
      repairInstruction: "Turn this slide into a diagram or an anchored photo scene; keep the summary text-led.",
    });
  }

  for (const slide of contentSlides) {
    const direction = directionByOrder.get(slide.order);
    if (direction?.imageStrategy !== "real_photo") continue;
    const anchors = slideSpecificVisualAnchors(slide, presentation);
    if (anchors.length && !containsVisualAnchor(direction.visualPrompt, anchors)) {
      issues.push({
        slideId: slide.id,
        severity: "major",
        category: "bad_visual",
        field: "designBrief.slideDirections.visualPrompt",
        message: "Real-photo direction omits the slide-specific entity, model, place, or era anchor.",
        repairInstruction: "Use the slide-specific anchor in the query, or switch to a diagram when a relevant photo is not available.",
      });
    }
    if (slide.visual.image?.provider === "tavily" && anchors.length && !containsVisualAnchor([
      slide.visual.image.alt,
      slide.visual.image.sourceTitle,
      slide.visual.image.sourceUrl,
    ].join(" "), anchors)) {
      issues.push({
        slideId: slide.id,
        severity: "major",
        category: "bad_visual",
        field: "visual.image",
        message: "Downloaded image metadata does not confirm a strong slide-specific anchor.",
        repairInstruction: "Discard this Tavily result and use a diagram or a candidate whose metadata matches the slide entity and era.",
      });
    }
  }

  const imageOwners = new Map<string, Slide[]>();
  for (const slide of contentSlides) {
    const image = slide.visual.image;
    if (!image?.objectKey || image.provider !== "tavily") continue;
    imageOwners.set(image.objectKey, [...(imageOwners.get(image.objectKey) || []), slide]);
  }
  for (const [objectKey, slides] of imageOwners) {
    if (slides.length < 2) continue;
    slides.slice(1).forEach((slide) => issues.push({
      slideId: slide.id,
      severity: "major",
      category: "bad_visual",
      field: "visual.image.objectKey",
      message: `Downloaded image objectKey ${objectKey} repeats on multiple slides.`,
      repairInstruction: "Use a distinct relevant candidate or replace this repeated Tavily image with a diagram.",
    }));
  }
  return issues;
}

/** Safe local repair: it changes generated direction and Tavily assets only. */
export function applyVisualPlanFallbacks(presentation: PresentationDocument, issues: QualityIssue[]): PresentationDocument {
  if (!issues.some((issue) => issue.category === "bad_visual")) return presentation;
  const designBrief = presentation.designBrief;
  const affectedIds = new Set(issues
    .filter((issue) => !issue.message.includes("Three consecutive"))
    .map((issue) => issue.slideId)
    .filter((id): id is string => Boolean(id)));
  const needsCoverageRepair = issues.some((issue) => issue.message.includes("visual coverage") || issue.message.includes("Three consecutive"));
  const duplicateAssetIds = new Set(issues.filter((issue) => issue.field === "visual.image.objectKey").map((issue) => issue.slideId).filter((id): id is string => Boolean(id)));
  const unfulfilledVisualIds = new Set(issues
    .filter((issue) => issue.field === "visual.image.url" || issue.field === "visual")
    .map((issue) => issue.slideId)
    .filter((id): id is string => Boolean(id)));
  const slides = presentation.slides.map((slide) => {
    if (unfulfilledVisualIds.has(slide.id)) {
      return withGroundedDiagramFallback(slide);
    }
    if (duplicateAssetIds.has(slide.id) && slide.visual.image?.provider === "tavily") return withGroundedDiagramFallback(slide);
    return slide;
  });
  const validSlides = slides.filter((slide): slide is PresentationDocument["slides"][number] => Boolean(slide));
  const slideByOrder = new Map(validSlides.map((slide) => [slide.order, slide]));
  const coverageFallbackOrders = new Set<number>();
  if (needsCoverageRepair && designBrief) {
    const contentDirections = designBrief.slideDirections.filter((direction) => slideByOrder.get(direction.slideOrder)?.slideKind === "content");
    const actualVisuals = contentDirections.filter((direction) => {
      const slide = slideByOrder.get(direction.slideOrder);
      return hasSubstantiveVisual(slide);
    }).length;
    let remaining = Math.max(0, Math.ceil(contentDirections.length * 0.8) - actualVisuals);
    for (const direction of contentDirections) {
      const slide = slideByOrder.get(direction.slideOrder);
      if (!remaining || !slide || hasSubstantiveVisual(slide)) continue;
      coverageFallbackOrders.add(direction.slideOrder);
      remaining -= 1;
    }
  }
  const fallbackSlides = validSlides
    .map((slide) => coverageFallbackOrders.has(slide.order) ? withGroundedDiagramFallback(slide) : slide)
    .filter((slide): slide is PresentationDocument["slides"][number] => Boolean(slide));
  const fallbackSlideByOrder = new Map(fallbackSlides.map((slide) => [slide.order, slide]));
  const directions = designBrief?.slideDirections.map((direction) => {
    const slide = fallbackSlideByOrder.get(direction.slideOrder);
    if (!slide || slide.slideKind === "summary") return slide?.slideKind === "summary"
      ? { ...direction, layoutIntent: "summary" as const, imageStrategy: "none" as const, sceneTextMode: "takeaway" as const }
      : direction;
    const needsFallback = affectedIds.has(slide.id) || coverageFallbackOrders.has(direction.slideOrder);
    const fallbackApplied = coverageFallbackOrders.has(direction.slideOrder)
      || unfulfilledVisualIds.has(slide.id)
      || duplicateAssetIds.has(slide.id);
    if (!needsFallback || (!fallbackApplied && hasSubstantiveVisual(slide))) return direction;
    return {
      ...direction,
      layoutIntent: "diagram" as const,
      imageStrategy: "diagram" as const,
      visualPurpose: "diagram" as const,
      visualRationale: "A local diagram preserves the explanation when a photo or generated visual is unavailable.",
      sceneTextMode: "visual_labels" as const,
      visualPrompt: `Explanatory diagram for ${cleanText(slide.title)}`,
    };
  });
  // Fallbacks are provider-independent data repairs, so parse the exact
  // replacement document before it can re-enter inspection or canvas rebuild.
  return presentationSchema.parse({
    ...presentation,
    slides: fallbackSlides,
    ...(designBrief && directions ? { designBrief: { ...designBrief, slideDirections: directions } } : {}),
  });
}

/**
 * A design brief is only a plan. Materialize its diagram directions into
 * slide data so the canvas builder, editor, and exporter all receive an
 * actual visual rather than a direction that they cannot render.
 */
export function materializePlannedVisuals(
  presentation: PresentationDocument,
  options: { refreshDiagramFallbacks?: boolean; fallbackMissingPhotos?: boolean } = {},
): PresentationDocument {
  const directions = new Map((presentation.designBrief?.slideDirections || []).map((direction) => [direction.slideOrder, direction]));
  const fallbackOrders = new Set<number>();
  let changed = false;
  const slides = presentation.slides.map((slide) => {
    const direction = directions.get(slide.order);
    const missingPlannedPhoto = slide.slideKind === "content"
      && options.fallbackMissingPhotos
      && direction?.imageStrategy === "real_photo"
      && !slide.visual.image;
    const missingImageVisual = options.fallbackMissingPhotos
      && slide.slideKind === "content"
      && ["image", "illustration"].includes(slide.visual.type)
      && !slide.visual.image;
    if (!missingPlannedPhoto && !missingImageVisual && (slide.visual.image || (isSemanticDiagram(slide) && !options.refreshDiagramFallbacks) || direction?.imageStrategy !== "diagram")) return slide;
    const fallback = withGroundedDiagramFallback(slide);
    if (!fallback) return slide;
    changed = true;
    fallbackOrders.add(slide.order);
    return fallback;
  });
  if (!changed) return presentation;
  const designBrief = presentation.designBrief
    ? {
      ...presentation.designBrief,
      slideDirections: presentation.designBrief.slideDirections.map((direction) => {
        if (!fallbackOrders.has(direction.slideOrder)) return direction;
        const slide = slides.find((candidate) => candidate.order === direction.slideOrder);
        return slide?.slideKind === "summary" ? {
          ...direction,
          layoutIntent: "summary" as const,
          imageStrategy: "none" as const,
          sceneTextMode: "takeaway" as const,
        } : withDiagramDirection(direction, slide);
      }),
    }
    : undefined;
  return presentationSchema.parse({ ...presentation, slides, ...(designBrief ? { designBrief } : {}) });
}

function isSemanticDiagram(slide: Slide | undefined) {
  return hasSubstantiveVisual(slide);
}

function withDiagramDirection(
  direction: DesignBriefSlideDirection,
  slide: Slide | undefined,
): DesignBriefSlideDirection {
  return {
    ...direction,
    layoutIntent: "diagram",
    imageStrategy: "diagram",
    visualPurpose: "diagram",
    visualRationale: "A local diagram preserves the explanation when a photo or generated visual is unavailable.",
    sceneTextMode: "visual_labels",
    visualPrompt: `Explanatory diagram for ${cleanText(slide?.title || direction.visualPrompt)}`,
  };
}

function withGroundedDiagramFallback(slide: Slide): Slide | null {
  const title = cleanText(slide.title);
  const thesis = cleanText(slide.thesis);
  const contentPoints = [
    ...slide.bullets,
    ...acceptedNarrationSentences([slide.speakerNotes]),
  ].map(cleanText).filter((point) => point
    && !semanticallyRepeats(point, title)
    && !semanticallyRepeats(point, thesis));
  const nodes: string[] = [];
  for (const point of contentPoints) {
    const key = normalizeQualityText(point);
    if (!key || nodes.some((node) => normalizeQualityText(node) === key)) continue;
    nodes.push(point);
    if (nodes.length === 3) break;
  }
  // A sparse section must stay sparse. Do not turn its title, thesis, or a
  // fabricated implication into a second diagram node.
  if (nodes.length < 2) return null;
  const diagramNodes: string[] = [];
  for (const node of nodes) {
    const compactNode = compactDiagramText(node, 120);
    const key = normalizeQualityText(compactNode);
    if (!key || diagramNodes.some((existing) => normalizeQualityText(existing) === key)) continue;
    diagramNodes.push(compactNode);
  }
  // The compact label is what the editor actually renders. Do not keep two
  // distinct long sentences if their visible labels collapse to one node.
  if (diagramNodes.length < 2) return null;
  const diagramSource = [
    "flowchart LR",
    ...diagramNodes.map((point, index) => `    N${index}[${mermaidFallbackText(point)}]`),
    ...diagramNodes.slice(0, -1).map((_, index) => `    N${index} --> N${index + 1}`),
  ].join("\n");
  return {
    ...slide,
    layout: "process" as const,
    // Keep labels out of the ordinary visible-text fields: copying bullets
    // into visual items was the local source of duplicate support text.
    visual: {
      type: "process_diagram" as const,
      title: "",
      description: `Схема поясняет ход рассуждения по теме: ${cleanText(slide.title)}.`,
      leftLabel: "",
      rightLabel: "",
      items: [],
      rows: [],
      diagram: {
        kind: "flowchart" as const,
        // These fields are generated from otherwise longer slide copy. Keep
        // the fallback itself schema-valid so a single verbose model response
        // cannot turn a release-ready document into a terminal job failure.
        title: compactDiagramText(slide.title, 90),
        caption: "",
        fallback: diagramNodes.join("\n"),
        safety: "safe" as const,
        source: diagramSource,
      },
      // Recovery canvas reads graph nodes directly. Keeping them separate
      // from bullets avoids reintroducing the thesis/title as a visual node.
      graph: {
        layoutDirection: "LR" as const,
        nodes: diagramNodes.map((node, index) => ({
          id: `recovery-node-${index + 1}`,
          label: node,
          detail: "",
        })),
        edges: diagramNodes.slice(0, -1).map((_, index) => ({
          id: `recovery-edge-${index + 1}`,
          source: `recovery-node-${index + 1}`,
          target: `recovery-node-${index + 2}`,
          label: "",
        })),
        fallback: diagramNodes.join("\n"),
        title: compactDiagramText(slide.title, 90),
      },
    },
  };
}

function mermaidFallbackText(value: string) {
  // Mermaid flowchart nodes render as compact labels in both the web canvas
  // and PPTX fallback. Keep them short enough to avoid clipped text.
  return cleanText(value).replace(/[<>{}[\]|"`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 36) || "Идея";
}

function compactDiagramText(value: string, maximum: number) {
  const text = cleanText(value);
  if (text.length <= maximum) return text;
  const limit = Math.max(1, maximum - 1);
  const boundary = text.slice(0, limit).replace(/\s+\S*$/, "").trim();
  const compact = boundary || text.slice(0, limit).trim();
  return /[.!?…]$/u.test(compact) ? compact : `${compact}.`;
}

// Kept as a named helper for the visual-quality rules that may consume it in a later gate.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isConcreteVisualTopic(presentation: PresentationDocument, project?: QualityProjectInput) {
  const text = [presentation.title, project?.title, project?.prompt, ...presentation.slides.map((slide) => slide.title)].filter(Boolean).join(" ");
  return /\b(?:porsche|bmw|mercedes|ferrari|car|vehicle|aircraft|ship|museum|painting|building|factory|laboratory|battle|city|country|person|product|device|model)\b|(?:автомобил|машин|самолет|корабл|музе|картина|здани|завод|лаборатор|город|стран|модель|\b\d{3,4}\b)/iu.test(text);
}

function slideSpecificVisualAnchors(slide: Slide, presentation: PresentationDocument) {
  const narrative = presentation.narrativePlan.find((item) => item.slideOrder === slide.order);
  return uniqueTokens([
    slide.title,
    narrative?.slideTitle || "",
    narrative?.keyMessage || "",
  ].join(" ").match(/[\p{L}\p{N}-]+/gu)?.map((token) => token.toLowerCase()).filter((token) => (
    /\d/.test(token) || /^(?:porsche|bmw|mercedes|ferrari|tesla|911|carrera)$/i.test(token)
  )) || []);
}

function containsVisualAnchor(value: string, anchors: string[]) {
  const tokens = new Set(cleanText(value).toLowerCase().match(/[\p{L}\p{N}-]+/gu) || []);
  return anchors.some((anchor) => tokens.has(anchor));
}

export function findDuplicateSlideIssues(presentation: PresentationDocument): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (let index = 1; index < presentation.slides.length; index += 1) {
    const previous = presentation.slides[index - 1];
    const current = presentation.slides[index];
    const similarity = jaccardSimilarity(slideMeaningTokens(previous), slideMeaningTokens(current));
    if (similarity >= 0.72) {
      issues.push({
        slideId: current.id,
        severity: "major",
        category: "duplicate",
        message: "Adjacent slide repeats the previous slide too closely.",
        repairInstruction: "Make this slide develop the story with a distinct point, example, or conclusion.",
      });
    }
  }
  return issues;
}

export function findFactualRiskIssues(presentation: PresentationDocument, sources: Source[]): QualityIssue[] {
  // With no source corpus in scope, provenance cannot be verified here. The
  // generator still removes false precision where possible, but a source-less
  // classroom deck must not be rejected solely for lacking a citation target.
  if (!sources.length) return [];
  return presentation.slides.flatMap((slide) => {
    // Titles and visual labels provide navigation. Treat only explanatory
    // content as a factual claim so a thematic heading alone cannot reject an
    // otherwise grounded slide.
    const text = factualClaimText(slide);
    if (!hasHighRiskClaim(text) || matchingSourceForSlide(slide, sources)) return [];
    return [{
      slideId: slide.id,
      severity: "minor" as const,
      category: "factual_risk" as const,
      message: "A precise visible claim has no matching source reference or source context.",
      repairInstruction: "Attach a matching existing source reference when its excerpt supports the claim; otherwise make the wording more general without inventing citation metadata.",
    }];
  });
}

function findMandatorySourceSnapshotIssues(presentation: PresentationDocument, sources: Source[], project?: QualityProjectInput): QualityIssue[] {
  if (!project?.mandatorySourceSnapshot) return [];
  const webSources = sources.filter((source) => source.type === "WEB" && source.url).slice(0, 4);
  if (webSources.length < 3) return [{ severity: "blocker", category: "factual_risk", message: "The mandatory source snapshot has fewer than three web sources.", repairInstruction: "Stop this run before release; collect a new source snapshot in a new generation run." }];
  const referenced = new Set(presentation.slides.flatMap((slide) => slide.sourceRefs.map((reference) => reference.sourceId)));
  const missing = webSources.filter((source) => !referenced.has(source.id));
  return missing.length ? [{ severity: "blocker", category: "factual_risk", message: "The released presentation is missing required source attributions.", repairInstruction: "Attach references from the saved source snapshot to factual slides before release." }] : [];
}

/**
 * Repairs provenance deterministically: attach only a source whose available
 * label/excerpt actually supports the claim, otherwise remove false precision.
 */
export function applySourceGroundingRepairs(
  presentation: PresentationDocument,
  sources: Source[] = presentation.sources,
): PresentationDocument {
  return presentationSchema.parse({
    ...presentation,
    slides: presentation.slides.map((slide) => {
      const sourceRefs = normalizeSourceRefs(slide.sourceRefs, sources);
      const normalized = { ...slide, sourceRefs };
      const text = factualSlideText(normalized);
      if (!hasHighRiskClaim(text) || matchingSourceForSlide(normalized, sources)) return normalized;

      const matching = sources.find((source) => sourceSupportsClaim(text, source));
      if (matching) {
        return { ...normalized, sourceRefs: normalizeSourceRefs([...sourceRefs, sourceRefFromSource(matching)], sources) };
      }
      return generalizeSlideClaims(normalized);
    }),
  });
}

export function applyEntityCategoryMismatchRepairs(presentation: PresentationDocument): PresentationDocument {
  const repair = (value: string) => cleanText(value)
    .replace(/BMW\s*328\s*(?:—|-|это|is)\s*(?:модель\s*)?(?:BMW\s*M|M[-\s]?модель)/giu, "BMW 328 — ранняя модель BMW")
    .replace(/(?:BMW\s*M|M[-\s]?модель)\s*(?:—|-|это|is)\s*(?:модель\s*)?BMW\s*328/giu, "BMW 328 — ранняя модель BMW");
  return presentationSchema.parse({
    ...presentation,
    slides: presentation.slides.map((slide) => ({
      ...slide,
      title: repair(slide.title),
      thesis: repair(slide.thesis),
      bullets: slide.bullets.map(repair),
      blocks: slide.blocks.map((block) => block.type === "bullets" ? { ...block, items: block.items.map(repair) } : { ...block, content: repair(block.content) }),
      definition: slide.definition ? { term: repair(slide.definition.term), text: repair(slide.definition.text) } : null,
      visual: {
        ...slide.visual,
        title: repair(slide.visual.title),
        description: repair(slide.visual.description),
        items: slide.visual.items.map((item) => ({ ...item, label: repair(item.label), text: repair(item.text) })),
        rows: slide.visual.rows.map((row) => ({ ...row, label: repair(row.label), left: repair(row.left), right: repair(row.right) })),
      },
    })),
  });
}

export function findWeakConclusionIssues(presentation: PresentationDocument, project: QualityProjectInput): QualityIssue[] {
  return presentation.slides.flatMap((slide) => {
    if (slide.order !== project.slideCount && slide.slideKind !== "summary") return [];
    const inspection = inspectConclusion(slide, project, presentation);
    if (!inspection.weak) return [];
    return [{
      slideId: slide.id,
      severity: "major" as const,
      category: inspection.offTopic ? "off_topic" as const : "bad_narration" as const,
      field: inspection.offTopic ? "visibleText" : "speakerNotes",
      message: inspection.offTopic
        ? "Final slide conclusion develops a different topic from the project."
        : `Final slide conclusion is weak: ${inspection.reasons.join(", ")}.`,
      repairInstruction: inspection.offTopic
        ? "Rebuild the final summary from accepted narration, the project takeaway, and earlier narrative-plan beats. Do not add facts."
        : "Rewrite the final slide with one complete topic-specific conclusion and 2-3 distinct takeaways grounded in earlier narrative-plan beats.",
    }];
  });
}

type ConclusionInspection = {
  weak: boolean;
  offTopic: boolean;
  reasons: string[];
};

function inspectConclusion(
  slide: Slide,
  project: QualityProjectInput,
  presentation?: PresentationDocument,
): ConclusionInspection {
  const visible = [slide.title, slide.thesis, ...slide.bullets].map(cleanText).filter(Boolean);
  const visibleText = visible.join(" ");
  const normalized = normalizeQualityText(visibleText);
  const topicAnchors = uniqueTokens(significantTokens(`${project.title} ${project.prompt}`)).slice(0, 10);
  const visibleTokens = uniqueTokens(significantTokens(visibleText));
  const hasTopicAnchor = topicAnchors.length === 0 || overlapCount(visibleTokens, topicAnchors) > 0;
  const genericEnding = isGenericConclusionEnding(normalized);
  const completeThesis = isCompleteConclusionStatement(slide.thesis);
  const supporting = uniqueConclusionPoints(slide.bullets);
  const duplicatedSupport = supporting.some((point, index) =>
    supporting.slice(index + 1).some((other) => semanticOverlap(point, other) >= 0.8),
  );
  const matchedNarrativeBeats = presentation && presentation.slides.length >= 5
    ? countMatchedNarrativeBeats(visibleText, presentation, slide.order)
    : 0;
  const insufficientBeatCoverage = Boolean(presentation && presentation.slides.length >= 5 && matchedNarrativeBeats < 2);
  const substantiallyDifferentTopic = !genericEnding
    && !hasTopicAnchor
    && foreignDomainSignalCount(visibleText) >= 2;
  const reasons = [
    ...(genericEnding ? ["courtesy or recap phrase without a conclusion"] : []),
    ...(!hasTopicAnchor ? ["missing project topic anchors"] : []),
    ...(!completeThesis ? ["main conclusion is not a complete statement"] : []),
    ...(supporting.length < 2 ? ["fewer than two supporting takeaways"] : []),
    ...(duplicatedSupport ? ["supporting takeaways repeat each other"] : []),
    ...(insufficientBeatCoverage ? ["does not synthesize two earlier narrative beats"] : []),
  ];
  // A compact closing slide can legitimately omit the project wording when it
  // is otherwise a complete, distinct synthesis. Foreign-topic conclusions
  // remain blocked above; the anchor alone is a weak signal, not a failure.
  const onlyMissingAnchor = reasons.length === 1 && reasons[0] === "missing project topic anchors";
  return { weak: (reasons.length > 0 && !onlyMissingAnchor) || substantiallyDifferentTopic, offTopic: substantiallyDifferentTopic, reasons };
}

function isGenericConclusionEnding(value: string) {
  const text = normalizeQualityText(value);
  if (!text) return true;
  return /^(?:спасибо(?: за внимание)?|вопросы|thank you|questions)(?:\s*[!?.,]*)?$/iu.test(text)
    || /^(?:мы рассмотрели|we considered|we have considered|в этой презентации рассмотрели)\b/iu.test(text)
    || /^(?:итог|вывод|conclusion|summary)\s*[!?.,]*$/iu.test(text);
}

function isCompleteConclusionStatement(value: string) {
  const text = cleanText(value);
  if (wordCount(text) < 4 || isGenericConclusionEnding(text)) return false;
  if (isClearlyIncompleteShortText(text) || /(?:\b(?:и|но|или|потому что|because|and|but|or|with|для|из|в|на)\s*)$/iu.test(text)) return false;
  return /[.!?]$/.test(text);
}

function uniqueConclusionPoints(values: string[]) {
  const points: string[] = [];
  for (const value of values.map(cleanText)) {
    // Supporting slots may be concise slide phrases, but they must still be
    // independently readable rather than grammatical continuations.
    if (wordCount(value) < 3 || isGenericConclusionEnding(value) || isClearlyIncompleteShortText(value)) continue;
    if (points.some((point) => semanticOverlap(point, value) >= 0.8)) continue;
    points.push(value);
  }
  return points;
}

function countMatchedNarrativeBeats(visibleText: string, presentation: PresentationDocument, conclusionOrder: number) {
  const conclusionTokens = uniqueTokens(significantTokens(visibleText));
  const beats = presentation.narrativePlan
    .filter((item) => item.slideOrder < conclusionOrder)
    .map((item) => `${item.slideTitle} ${item.keyMessage} ${item.slidePurpose}`)
    .filter((item) => significantTokens(item).length >= 2);
  return beats.filter((beat) => overlapCount(conclusionTokens, uniqueTokens(significantTokens(beat))) >= 2).length;
}

export function findUniversityToneIssues(
  presentation: PresentationDocument,
  project?: QualityProjectInput,
): QualityIssue[] {
  if (scoreUniversityTone(presentation, project).score >= WEAK_DIMENSION_THRESHOLD) return [];
  return [{
    severity: "major",
    category: "off_topic",
    field: "universityTone",
    message: "The deck uses school-oriented or childish wording for a university audience.",
    repairInstruction: "Rewrite the affected wording in an easy-professional university student voice.",
  }];
}

export function findShortNarrationIssues(presentation: PresentationDocument): QualityIssue[] {
  return presentation.slides.flatMap((slide) => {
    const script = presentation.speechScript.find((item) => item.slideOrder === slide.order);
    if (wordCount(slide.speakerNotes) >= 35 && script && wordCount(script.text) >= 35) return [];
    return [{
      slideId: slide.id,
      severity: "major" as const,
      category: "bad_narration" as const,
      field: "speakerNotes, speechScript",
      message: "The spoken explanation is too short for a natural university report.",
      repairInstruction: "Rewrite speakerNotes and the matching speechScript from the accepted narration with at least 35 natural spoken words.",
    }];
  });
}

export function findSpeechTimingIssues(presentation: PresentationDocument, project?: QualityProjectInput): QualityIssue[] {
  if (!project) return [];
  const budget = getRussianStudentSpeechTimingBudget(project);
  if (!budget) return [];
  const words = presentation.speechScript.reduce((total, item) => total + wordCount(item.text), 0);
  const minutes = russianSpeechMinutesFromWords(words, budget.wordsPerMinute);
  if (words >= budget.minWords && (budget.maxWords === undefined || words <= budget.maxWords)) return [];
  const tooShort = words < budget.minWords;
  return [{
    severity: "blocker",
    category: "bad_narration",
    field: "generatedText, speakerNotes, speechScript",
    message: tooShort
      ? `Speech duration is below ${budget.minMinutes} minutes: ${words} words (${minutes.toFixed(1)} min).`
      : `Speech duration exceeds ${budget.maxMinutes} minutes: ${words} words (${minutes.toFixed(1)} min).`,
    repairInstruction: tooShort
      ? "Regenerate or expand only the accepted grounded narration to the timing budget; explain the significance of existing facts and do not invent new facts. Then synchronize speakerNotes and speechScript."
      : "Regenerate or compress accepted narration to the timing budget without losing grounded facts; then synchronize speakerNotes and speechScript.",
  }];
}

export function findExportReadinessIssues(presentation: PresentationDocument): QualityIssue[] {
  return presentation.slides.flatMap((slide) => {
    const theme = resolvePresentationTheme({
      title: presentation.title,
      scenario: presentation.scenario,
      level: presentation.level,
      presentationTheme: presentation.presentationTheme,
      designBrief: presentation.designBrief,
    });
    // A custom canvas belongs to the user. It can be reported by export
    // diagnostics, but quality repair must never replace it with generated art.
    if (hasCustomSlideCanvas(slide, theme)) return [];
    const canvasIssue = slide.canvas ? auditSlideCanvas(slide.canvas)[0] : "canvas is missing";
    const singleSlide = presentationSchema.parse({
      ...presentation,
      slideCount: 1,
      slides: [{ ...slide, order: 1 }],
      outline: [slide.title],
      narrativePlan: [],
      speechScript: [{ slideOrder: 1, slideTitle: slide.title, text: slide.speakerNotes }],
    });
    if (scoreExportReadiness(singleSlide).score >= WEAK_DIMENSION_THRESHOLD) return [];
    return [{
      slideId: slide.id,
      severity: "major" as const,
      category: "schema_risk" as const,
      field: canvasIssue ? `canvas.${canvasIssue.split(" ")[0]}` : "canvas",
      message: `The generated slide canvas is unsafe for export: ${canvasIssue || "unknown canvas issue"}.`,
      repairInstruction: "Shorten visible text or use a roomier generated layout, then rebuild the canvas without changing a user-edited custom canvas.",
    }];
  });
}

export function findVisualFulfillmentIssues(presentation: PresentationDocument): QualityIssue[] {
  return presentation.slides.flatMap((slide) => {
    const plannedPhoto = presentation.designBrief?.slideDirections.some((direction) => direction.slideOrder === slide.order && direction.imageStrategy === "real_photo") || false;
    const imageDeclared = slide.visual.type === "image" || (slide.layout === "image-focus" && (!plannedPhoto || isManagedSlideCount(presentation.slideCount)));
    const diagramDeclared = (isManagedSlideCount(presentation.slideCount) || slide.visual.type === "process_diagram")
      && ["process_diagram", "comparison_diagram", "cause_effect_diagram", "before_after_table", "pros_cons_table", "timeline", "mind_map", "schema"].includes(slide.visual.type);
    if ((!imageDeclared && !diagramDeclared) || hasSubstantiveVisual(slide)) return [];
    const imageMissing = imageDeclared;
    return [{
        slideId: slide.id,
        severity: "blocker" as const,
        category: "bad_visual" as const,
        field: imageMissing ? "visual.image.url" : "visual",
        message: imageMissing
          ? "Image visual or image-focus layout has no fulfilled image URL."
          : "Diagram visual has no substantive payload.",
        repairInstruction: imageMissing
          ? "Fulfill the requested image or replace this generated visual with a deterministic diagram; never leave an empty image slot."
          : "Build a deterministic diagram with at least two labeled nodes and a connection; never leave an empty diagram field.",
      }];
  });
}

export function findCanvasCanonicalContentIssues(presentation: PresentationDocument): QualityIssue[] {
  return presentation.slides.flatMap((slide) => slide.canvas?.elements.some((element) => element.id === `${slide.id}-custom-canvas-marker`)
    ? []
    // Generation repairs text before its final deterministic canvas rebuild.
    // Keep this gate on stable generated slots; deeper persisted canonicality
    // is enforced again by export preflight for the released revision.
    : auditGeneratedCanvasText(slide.canvas, slide).map((message) => ({
        slideId: slide.id,
        severity: "blocker" as const,
        category: "schema_risk" as const,
        field: "canvas",
        message,
        repairInstruction: "Rebuild the generated canvas from canonical slide fields without changing a custom canvas.",
      })));
}

export function productionQualityReleaseResult(
  presentation: PresentationDocument,
  sources: Source[],
  project: QualityProjectInput,
  attempts = 0,
): ProductionQualityReleaseResult {
  const baseCritique = critiquePresentationDeterministically(presentation, sources, project);
  const hasCanonicalAcceptedNarration = parseAcceptedNarrationSections(presentation.generatedText).length === presentation.slides.length
    && !findSlideSpeechAlignmentIssues(presentation).some((issue) => issue.field === "speechScript");
  const critique = project.acceptedNarrationRecovery || hasCanonicalAcceptedNarration
    ? {
        ...baseCritique,
        issues: baseCritique.issues.filter((issue) => !(
          (issue.category === "generic_text" || issue.category === "bad_narration")
          && (issue.field === "speakerNotes" || (project.acceptedNarrationRecovery && issue.field === "speechScript"))
        )),
      }
    : baseCritique;
  // AITunnel is a production provider alongside Yandex. A run with a
  // persisted economic source snapshot may also use its local projection
  // after accepted narration. Neither path may pass with a demo or fallback
  // document.
  const allowedGenerationModes = project.mandatorySourceSnapshot
    ? ["local", "aitunnel"]
    : ["yandex", "aitunnel"];
  const candidateIssues = allowedGenerationModes.includes(presentation.generationMode)
    ? critique.issues
    : [...critique.issues, {
        severity: "blocker" as const,
        category: "schema_risk" as const,
        field: "generationMode",
        message: project.mandatorySourceSnapshot
          ? "Economic presentation was not assembled from accepted narration locally or through AITunnel."
          : "Generated presentation was not produced by an approved production provider.",
        repairInstruction: project.mandatorySourceSnapshot
          ? "Resume the linked presentation job from accepted narration using AITunnel or the local projection; do not use a demo or provider fallback document."
          : "Run a new generation with Yandex or AITunnel configured; do not substitute a local fallback document.",
      }];
  // Accepted-narration recovery may intentionally concentrate deterministic
  // diagram layouts after failed photo enrichment. Keep those advisory rhythm
  // diagnostics out of the release result; substantive visual blockers and
  // majors remain enforced.
  const issues = project.acceptedNarrationRecovery
    ? candidateIssues.filter((issue) => !(issue.category === "bad_visual"
      && issue.severity === "minor"
      && (issue.field === "layout" || issue.field?.startsWith("designBrief.slideDirections."))))
    : candidateIssues;
  return {
    issueCategories: [...new Set(issues.map((issue) => issue.category))],
    attempts,
    // Minor findings remain in diagnostics for a later polish pass. Blockers
    // always stop release; major findings retain the calibrated score threshold
    // so one repairable concern does not outweigh an otherwise sound deck.
    finalDisposition: issues.some((issue) => issue.severity === "blocker")
      || (issues.some((issue) => issue.severity === "major") && critique.score < QUALITY_SCORE_THRESHOLD)
      ? "rejected"
      : "released",
    issues: issues.map((issue) => ({
      slideId: issue.slideId,
      field: issue.field || "document",
      severity: issue.severity,
      category: issue.category,
      repairable: issue.severity !== "blocker" || issue.category === "bad_visual" || issue.category === "schema_risk",
    })),
  };
}

export function scorePresentationQuality(
  presentation: PresentationDocument,
  issues: QualityIssue[],
  sources: Source[] = presentation.sources,
  project?: QualityProjectInput,
): QualityCritique {
  const penalty = issues.reduce((total, issue) => total + (issue.severity === "blocker" ? 35 : issue.severity === "major" ? 15 : 6), 0);
  const dimensions = scoreQualityDimensions(presentation, sources, project);
  const dimensionAverage = averageDimensionScore(dimensions);
  const score = Math.max(0, Math.min(100 - penalty, dimensionAverage));
  const summary = issues.length
    ? `${issues.length} quality issue(s): ${issueCountsByCategory(issues)}.`
    : "No quality issues found.";
  return {
    score,
    summary,
    dimensions,
    issues,
    passed: score >= QUALITY_SCORE_THRESHOLD && !issues.some((issue) => issue.severity === "blocker"),
  };
}

export function critiquePresentationDeterministically(
  presentation: PresentationDocument,
  sources: Source[] = presentation.sources,
  project?: QualityProjectInput,
): QualityCritique {
  const semanticIssues = collectSemanticQualityIssues(presentation, [
    findGenericTextIssues, findVisibleTextIntegrityIssues, findContentSlideContractIssues,
    findIntraSlideDuplicateIssues, findRepeatedTitleIssues, findLongSlideTextIssues,
    findNarrationMetaIssues, findLayoutRhythmIssues, findVisualDescriptionIssues,
    findDuplicateSlideIssues, findDeckWideDuplicateIssues, findRepeatedSentenceStartIssues,
    findSlideSpeechAlignmentIssues, (document) => findUniversityToneIssues(document, project),
    findShortNarrationIssues, (document) => findSpeechTimingIssues(document, project),
    findExportReadinessIssues, findVisualFulfillmentIssues, findCanvasCanonicalContentIssues,
    ...(project ? [(document: PresentationDocument) => findWeakConclusionIssues(document, project), (document: PresentationDocument) => findTopicRelevanceIssues(document, project), (document: PresentationDocument) => findOffTopicVisualIssues(document, project), (document: PresentationDocument) => findVisualPlanIssues(document, project)] : [(document: PresentationDocument) => findVisualPlanIssues(document)]),
  ]);
  const sourceIssues = collectSourceGroundingIssues(presentation, sources, [
    findFactualRiskIssues,
    (document, availableSources) => findMandatorySourceSnapshotIssues(document, availableSources, project),
    (document) => findEntityCategoryMismatchIssues(document),
  ]);
  const issues = dedupeIssues([...semanticIssues, ...sourceIssues]);
  return scorePresentationQuality(presentation, issues, sources, project);
}

export function shouldRunModelCritic(critique: QualityCritique, presentation: PresentationDocument, sources: Source[]) {
  return critique.score < QUALITY_SCORE_THRESHOLD
    && (critique.issues.some((issue) => issue.severity !== "minor")
      || weakestDimensionScore(critique) < WEAK_DIMENSION_THRESHOLD
      || presentation.slides.length > 4
      || sources.length === 0);
}

export async function improvePresentationQuality(
  presentation: PresentationDocument,
  project: QualityProjectInput,
  sources: Source[],
  provider: GenerationMode,
  options: ImprovePresentationQualityOptions = {},
): Promise<PresentationDocument> {
  let best = applyInitialQualityRepairs(presentationSchema.parse(presentation), [
    (document) => applySourceGroundingRepairs(document, sources),
    applyEntityCategoryMismatchRepairs,
    rebuildGeneratedCanvases,
  ]);
  let bestCritique = critiquePresentationDeterministically(best, sources, project);
  const initialCritique = bestCritique;
  let modelCritique = bestCritique;

  if ((bestCritique.dimensions?.exportReadiness.score ?? 100) < WEAK_DIMENSION_THRESHOLD) {
    const exportReady = rebuildGeneratedCanvases(best);
    const exportReadyCritique = critiquePresentationDeterministically(exportReady, sources, project);
    if (exportReadyCritique.score >= bestCritique.score) {
      best = exportReady;
      bestCritique = exportReadyCritique;
      modelCritique = exportReadyCritique;
    }
  }

  if (!isDemoProvider(provider) && options.critique && shouldRunModelCritic(bestCritique, best, sources)) {
    try {
      modelCritique = mergeCritiques(bestCritique, parseQualityCritique(await options.critique(best, bestCritique)));
      bestCritique = modelCritique.score < bestCritique.score ? modelCritique : bestCritique;
    } catch (error) {
      logger.warn({ projectId: project.id, stage: "polishing", provider, ...errorLogFields(error) }, "presentation quality model critique failed");
    }
  }

  const beforeScore = initialCritique.score;
  let attempts = 0;
  const maxAttempts = options.maxRepairAttempts ?? MAX_DEFAULT_REPAIR_ATTEMPTS;
  while (
    !isDemoProvider(provider)
    && options.repair
    && bestCritique.score < QUALITY_SCORE_THRESHOLD
    && (bestCritique.issues.some((issue) => issue.severity !== "minor")
      || weakestDimensionScore(bestCritique) < WEAK_DIMENSION_THRESHOLD)
    && attempts < maxAttempts
  ) {
    attempts += 1;
    try {
      const repaired = rebuildGeneratedCanvases(
        applyQualityRepairs(best, await options.repair(best, targetedRepairIssues(bestCritique), attempts), project),
      );
      const parsed = presentationSchema.parse(repaired);
      const repairedCritique = critiquePresentationDeterministically(parsed, sources, project);
      if (repairedCritique.score >= bestCritique.score) {
        best = parsed;
        bestCritique = repairedCritique;
      }
      if (bestCritique.score >= QUALITY_SCORE_THRESHOLD) break;
    } catch (error) {
      logger.warn({ projectId: project.id, stage: "polishing", provider, repairAttempts: attempts, ...errorLogFields(error) }, "presentation quality repair failed");
      break;
    }
  }

  const unresolvedTopicIssues = [...findTopicRelevanceIssues(best, project), ...findOffTopicVisualIssues(best, project)];
  if (unresolvedTopicIssues.length) {
    const beforeTopicRepair = bestCritique.score;
    const fallbackSource = unresolvedTopicIssues.every((issue) => {
      const slide = best.slides.find((candidate) => candidate.id === issue.slideId);
      const script = slide && best.speechScript.find((item) => item.slideOrder === slide.order)?.text;
      return Boolean((slide?.speakerNotes || script || "").trim());
    }) ? "accepted_narration" : "narrative_plan";
    const fallback = rebuildTopicRepairedCanvases(
      applyTopicRelevanceFallbacks(best, unresolvedTopicIssues, project),
      new Set(unresolvedTopicIssues.map((issue) => issue.slideId).filter((id): id is string => Boolean(id))),
    );
    const fallbackCritique = critiquePresentationDeterministically(fallback, sources, project);
    if (fallbackCritique.score >= bestCritique.score || !findTopicRelevanceIssues(fallback, project).length) {
      best = fallback;
      bestCritique = fallbackCritique;
    }
    logger.warn({
      projectId: project.id,
      stage: "polishing",
      provider,
      category: "off_topic",
      repairStrategy: "accepted_narration",
      fallbackSource,
      slideOrders: unresolvedTopicIssues.map((issue) => best.slides.find((slide) => slide.id === issue.slideId)?.order).filter(Boolean),
      repairedSlideCount: unresolvedTopicIssues.length,
      beforeScore: beforeTopicRepair,
      afterScore: bestCritique.score,
    }, "presentation topic relevance repaired");
  }

  const conclusionIssues = findWeakConclusionIssues(best, project)
    // A lone absent anchor can be an intentionally compact title in an
    // otherwise coherent deck. Preserve that valid compatibility case; all
    // generic, incomplete, duplicate, off-topic, or unsynthesized endings
    // still receive the deterministic new-generation repair below.
    .filter((issue) => issue.category === "off_topic" || !/: missing project topic anchors\.?$/iu.test(issue.message));
  if (conclusionIssues.length) {
    const affectedSlideIds = new Set(conclusionIssues
      .map((issue) => issue.slideId)
      .filter((id): id is string => Boolean(id)));
    const fallback = rebuildTopicRepairedCanvases(
      applyConclusionFallbacks(best, conclusionIssues, project),
      affectedSlideIds,
    );
    const fallbackCritique = critiquePresentationDeterministically(fallback, sources, project);
    if (fallbackCritique.score >= bestCritique.score || !findWeakConclusionIssues(fallback, project).length) {
      best = fallback;
      bestCritique = fallbackCritique;
    }
    logger.warn({
      projectId: project.id,
      stage: "polishing",
      provider,
      category: "conclusion",
      slideOrders: [...affectedSlideIds].map((id) => best.slides.find((slide) => slide.id === id)?.order).filter(Boolean),
      repairedSlideCount: affectedSlideIds.size,
    }, "presentation conclusion repaired from accepted narration and narrative beats");
  }

  const alignmentIssues = findSlideSpeechAlignmentIssues(best);
  if (alignmentIssues.length) {
    const affectedSlideIds = new Set(alignmentIssues
      .filter((issue) => issue.field === "visibleText")
      .map((issue) => issue.slideId)
      .filter((id): id is string => Boolean(id)));
    const fallback = rebuildTopicRepairedCanvases(
      applySlideSpeechAlignmentFallbacks(best, alignmentIssues, project),
      affectedSlideIds,
    );
    const fallbackCritique = critiquePresentationDeterministically(fallback, sources, project);
    if (fallbackCritique.score >= bestCritique.score || !findSlideSpeechAlignmentIssues(fallback).length) {
      best = fallback;
      bestCritique = fallbackCritique;
    }
    logger.warn({
      projectId: project.id,
      stage: "polishing",
      provider,
      category: "slide_speech_alignment",
      slideOrders: alignmentIssues.map((issue) => best.slides.find((slide) => slide.id === issue.slideId)?.order).filter(Boolean),
      repairedSlideCount: new Set(alignmentIssues.map((issue) => issue.slideId).filter(Boolean)).size,
    }, "presentation slide and speech alignment repaired");
  }

  const contentIssues = [
    ...findGenericTextIssues(best),
    ...findVisibleTextIntegrityIssues(best),
    ...findContentSlideContractIssues(best),
    // Dense visible copy is mechanically recoverable from the accepted
    // narration; repair it before escalating to another paid model pass.
    ...findLongSlideTextIssues(best),
    ...findIntraSlideDuplicateIssues(best),
    // Exact deck-wide central-claim repeats are safe to replace locally from
    // the matching narrative-plan job. Softer semantic matches stay in the
    // targeted model-repair path to avoid flattening legitimate timelines.
    ...findDeckWideDuplicateIssues(best).filter((issue) => issue.severity === "blocker"),
    ...findEntityCategoryMismatchIssues(best),
  ];
  if (contentIssues.length) {
    const releaseTextIssuesBefore = [
      ...findGenericTextIssues(best),
      ...findLongSlideTextIssues(best),
      ...findVisibleTextIntegrityIssues(best),
      ...findContentSlideContractIssues(best),
      ...findIntraSlideDuplicateIssues(best),
      ...findDeckWideDuplicateIssues(best).filter((issue) => issue.severity === "blocker"),
    ];
    const affectedSlideIds = new Set(contentIssues
      .map((issue) => issue.slideId)
      .filter((id): id is string => Boolean(id)));
    const fallback = rebuildTopicRepairedCanvases(
      applyVisibleTextIntegrityFallbacks(best, contentIssues, project),
      affectedSlideIds,
    );
    const fallbackCritique = critiquePresentationDeterministically(fallback, sources, project);
    const remaining = [
      ...findGenericTextIssues(fallback),
      ...findLongSlideTextIssues(fallback),
      ...findVisibleTextIntegrityIssues(fallback),
      ...findContentSlideContractIssues(fallback),
      ...findIntraSlideDuplicateIssues(fallback),
      ...findDeckWideDuplicateIssues(fallback).filter((issue) => issue.severity === "blocker"),
    ];
    if (fallbackCritique.score >= bestCritique.score || remaining.length < releaseTextIssuesBefore.length || !remaining.length) {
      best = fallback;
      bestCritique = fallbackCritique;
    }
    logger.warn({
      projectId: project.id,
      stage: "polishing",
      provider,
      category: "visible_text_integrity",
      slideOrders: [...affectedSlideIds].map((id) => best.slides.find((slide) => slide.id === id)?.order).filter(Boolean),
      repairedSlideCount: affectedSlideIds.size,
    }, "presentation duplicate or fragment repair applied");
  }

  const visualPlanIssues = [...findVisualPlanIssues(best, project), ...findVisualFulfillmentIssues(best)];
  if (visualPlanIssues.length) {
    const affectedSlideIds = new Set(visualPlanIssues.map((issue) => issue.slideId).filter((id): id is string => Boolean(id)));
    const directionBefore = new Map((best.designBrief?.slideDirections || []).map((direction) => [direction.slideOrder, JSON.stringify(direction)]));
    const plannedFallback = applyVisualPlanFallbacks(best, visualPlanIssues);
    plannedFallback.designBrief?.slideDirections.forEach((direction) => {
      if (directionBefore.get(direction.slideOrder) !== JSON.stringify(direction)) {
        const slide = plannedFallback.slides.find((candidate) => candidate.order === direction.slideOrder);
        if (slide) affectedSlideIds.add(slide.id);
      }
    });
    const fallback = rebuildTopicRepairedCanvases(plannedFallback, affectedSlideIds);
    const fallbackCritique = critiquePresentationDeterministically(fallback, sources, project);
    if (fallbackCritique.score >= bestCritique.score || !findVisualPlanIssues(fallback, project).length) {
      best = fallback;
      bestCritique = fallbackCritique;
    }
    logger.warn({ projectId: project.id, stage: "polishing", provider, category: "bad_visual", repairedSlideCount: affectedSlideIds.size }, "presentation visual-plan fallback applied");
  }

  logger.info({
    projectId: project.id,
    stage: "polishing",
    provider,
    beforeScore,
    afterScore: bestCritique.score,
    dimensions: dimensionScoresRecord(bestCritique.dimensions),
    weakestDimensions: weakestDimensionNames(bestCritique),
    issueCounts: issueCountsRecord(bestCritique.issues),
    repairAttempts: attempts,
  }, "presentation quality");

  if (bestCritique.score < QUALITY_SCORE_THRESHOLD) {
    logger.warn({
      projectId: project.id,
      stage: "polishing",
      provider,
      score: bestCritique.score,
      dimensions: dimensionScoresRecord(bestCritique.dimensions),
      issueCounts: issueCountsRecord(bestCritique.issues),
    }, "presentation quality remains below threshold; saving best valid version");
  }

  return best;
}

export function applyQualityRepairs(
  presentation: PresentationDocument,
  rawRepairs: unknown,
  project?: QualityProjectInput,
): PresentationDocument {
  const response = rawRepairs && typeof rawRepairs === "object" ? (rawRepairs as QualityRepairResponse) : {};
  const slides = Array.isArray(response.slides) && response.slides.length
    ? presentation.slides.map((slide) => {
        const repair = response.slides?.find((candidate) =>
          candidate.slideId === slide.id || Number(candidate.slideOrder) === slide.order,
        );
        if (!repair) return slide;
        return {
          ...slide,
          title: cleanText(repair.title) || slide.title,
          layout: repair.layout || slide.layout,
          thesis: cleanText(repair.thesis) || slide.thesis,
          bullets: Array.isArray(repair.bullets) ? repair.bullets.map(cleanText).filter(Boolean).slice(0, 5) : slide.bullets,
          blocks: Array.isArray(repair.blocks) ? repair.blocks : slide.blocks,
          visual: repair.visual
            ? normalizeVisual(
                { ...slide.visual, ...repair.visual },
                cleanText(repair.title) || slide.title,
                cleanText(repair.thesis) || slide.thesis,
                Array.isArray(repair.bullets) ? repair.bullets.map(cleanText).filter(Boolean).slice(0, 5) : slide.bullets,
                slide.slideKind,
                project || {
                  id: presentation.id,
                  title: presentation.title,
                  prompt: presentation.title,
                  scenario: presentation.scenario,
                  level: presentation.level,
                  mode: "with_sources",
                  slideCount: presentation.slideCount,
                },
                slide.order,
              )
            : slide.visual,
          // The accepted narration is the canonical, evidence-reviewed speech.
          // Polishing may improve visible slide content, but must never replace it.
          speakerNotes: slide.speakerNotes,
          sourceRefs: normalizeSourceRefs(Array.isArray(repair.sourceRefs) ? repair.sourceRefs : slide.sourceRefs, presentation.sources),
        };
      })
    : presentation.slides;

  const speechScript = presentation.speechScript.map((item) => {
    const slide = slides.find((candidate) => candidate.order === item.slideOrder);
    return slide ? { ...item, slideOrder: item.slideOrder, slideTitle: slide.title, text: slide.speakerNotes } : item;
  });
  const repairedGeneratedText = cleanMultilineText(response.generatedText);
  const generatedText = keepsExpectedNarrationSections(repairedGeneratedText, presentation)
    ? repairedGeneratedText
    : presentation.generatedText;
  const repairedOutline = Array.isArray(response.outline) ? response.outline.map(cleanText).filter(Boolean) : [];
  const outline = repairedOutline.length >= slides.length ? repairedOutline : slides.map((slide) => slide.title);

  return presentationSchema.parse({
    ...presentation,
    generatedText,
    outline,
    speechScript,
    slides,
  });
}

/**
 * Last-resort, deterministic repair for leaked visible copy. The canonical
 * accepted narration remains untouched; this function derives compact screen
 * text only from the matching accepted narration section.
 */
export function applyTopicRelevanceFallbacks(
  presentation: PresentationDocument,
  issues: QualityIssue[],
  project: QualityProjectInput,
): PresentationDocument {
  const affected = new Set(issues
    .filter((issue) => issue.category === "off_topic" && (issue.field === "visibleText" || issue.field === "visual.description"))
    .map((issue) => issue.slideId)
    .filter((id): id is string => Boolean(id)));
  if (!affected.size) return presentation;
  const fieldsBySlide = new Map<string, Set<string>>();
  issues.forEach((issue) => {
    if (!issue.slideId || !issue.field) return;
    const fields = fieldsBySlide.get(issue.slideId) || new Set<string>();
    fields.add(issue.field === "visibleText" ? "keyMessage" : issue.field);
    fieldsBySlide.set(issue.slideId, fields);
  });
  return rebuildVisibleContentFromAcceptedNarration(presentation, affected, project, fieldsBySlide);
}

/**
 * Deterministic final repair for incomplete fields and duplicate content. It
 * derives a compact visible surface from accepted narration while preserving
 * speaker notes, source refs, and any user-created canvas.
 */
export function applyVisibleTextIntegrityFallbacks(
  presentation: PresentationDocument,
  issues: QualityIssue[],
  project: QualityProjectInput,
): PresentationDocument {
  const affected = new Set(issues
    .filter((issue) => issue.category === "duplicate" || issue.category === "generic_text" || issue.category === "too_long" || issue.message.startsWith("Visible text is incomplete:") || issue.field === "contentContract")
    .map((issue) => issue.slideId)
    .filter((id): id is string => Boolean(id)));
  const fieldsBySlide = new Map<string, Set<string>>();
  issues.forEach((issue) => {
    if (!issue.slideId) return;
    const fields = fieldsBySlide.get(issue.slideId) || new Set<string>();
    if (issue.category === "duplicate") fields.add("duplicate");
    if (issue.field) fields.add(issue.field);
    fieldsBySlide.set(issue.slideId, fields);
  });
  return affected.size ? rebuildVisibleContentFromAcceptedNarration(presentation, affected, project, fieldsBySlide) : presentation;
}

/**
 * New-generation-only conclusion repair. It never deletes or edits slides in
 * a stored deck: improvePresentationQuality invokes it while building a new
 * document, and export/view paths do not call this function. The accepted
 * narration remains canonical; the summary surface is rebuilt only from its
 * matching accepted section, never from the narrative plan or project text.
 */
export function applyConclusionFallbacks(
  presentation: PresentationDocument,
  issues: QualityIssue[],
  _project: QualityProjectInput,
): PresentationDocument {
  const affected = new Set(issues
    .filter((issue) => issue.category === "bad_narration" || issue.category === "off_topic")
    .map((issue) => issue.slideId)
    .filter((id): id is string => Boolean(id)));
  if (!affected.size) return presentation;

  const acceptedByOrder = new Map(parseAcceptedNarrationSections(presentation.generatedText)
    .map((section) => [section.order, section]));
  const slides = presentation.slides.map((slide) => {
    // A conclusion fallback is local to an actual summary surface. Content
    // slides use the regular visible-text fallback instead.
    if (!affected.has(slide.id) || (slide.slideKind !== "summary" && slide.order !== presentation.slides.length)) return slide;
    const section = acceptedByOrder.get(slide.order);
    const accepted = acceptedNarrationSentences([section?.text || ""]);
    // Missing accepted narration is a release-blocking structural defect, not
    // permission to borrow project, narrative, or earlier-slide text.
    if (!accepted.length) return slide;
    const title = compactAcceptedNarrationTitle(section?.title || "", accepted);
    const thesis = compactSentence(accepted[0], 26);
    const supporting = uniqueCompactSentences(accepted.slice(1), thesis)
      .filter((point) => !isLowInformationProjection(point) && !hasMetaSlideLanguage(point) && !visibleTextIntegrityReason(point, false))
      .slice(0, 3);
    const visual = {
      ...slide.visual,
      title: "",
      description: "",
      leftLabel: "",
      rightLabel: "",
      items: [],
      rows: [],
    };
    return {
      ...slide,
      title,
      slideKind: "summary" as const,
      layout: "summary" as const,
      thesis,
      bullets: supporting,
      // Bullets are the canonical compact projection. Do not mirror them into
      // a second rendered block during repair.
      blocks: [],
      definition: slide.definition ? { term: title, text: thesis } : null,
      // The accepted narration and source refs are evidence-reviewed; do not
      // replace either one just to make the compact final surface look nicer.
      speakerNotes: slide.speakerNotes,
      visual,
    };
  });
  const speechScript = presentation.speechScript.map((item) => {
    const slide = slides.find((candidate) => candidate.order === item.slideOrder);
    return slide ? { ...item, slideTitle: slide.title, text: slide.speakerNotes } : item;
  });
  return presentationSchema.parse({
    ...presentation,
    slideCount: slides.length,
    outline: slides.map((slide) => slide.title),
    slides,
    speechScript,
  });
}

function rebuildVisibleContentFromAcceptedNarration(
  presentation: PresentationDocument,
  affected: Set<string>,
  _project: QualityProjectInput,
  fieldsBySlide?: Map<string, Set<string>>,
): PresentationDocument {

  const slides = presentation.slides.map((slide) => {
    if (!affected.has(slide.id)) return slide;
    const affectedFields = fieldsBySlide?.get(slide.id);
    const strictContentRepair = slide.slideKind === "content" && affectedFields?.has("contentContract");
    const replaceAllVisible = !affectedFields || affectedFields.has("keyMessage") || affectedFields.has("duplicate");
    const needsField = (prefix: string) => strictContentRepair || replaceAllVisible || [...affectedFields || []].some((field) => field === prefix || field.startsWith(`${prefix}.`));
    const acceptedSection = parseAcceptedNarrationSections(presentation.generatedText)
      .find((section) => section.order === slide.order);
    // The accepted section is the sole text donor. Notes and the narrative
    // plan are projections or structure and can never refill this slide.
    const candidates = acceptedNarrationSentences([acceptedSection?.text || ""]);
    if (!candidates.length) return slide;
    const title = compactAcceptedNarrationTitle(acceptedSection?.title || "", candidates);
    const thesis = compactSentence(candidates[0], 26);
    const candidateBullets = uniqueCompactSentences(candidates.slice(1), thesis).slice(0, 3);
    const narrationBullets = candidateBullets.filter((bullet) =>
      !semanticallyRepeats(bullet, thesis)
      && !isLowInformationProjection(bullet)
      && !hasMetaSlideLanguage(bullet)
      && !visibleTextIntegrityReason(bullet, false),
    );
    const existingBullets = uniqueRecoveryBullets(slide.bullets, title, thesis);
    const bulletFieldAffected = [...affectedFields || []].some((field) => field === "bullets" || field.startsWith("bullets."));
    // A field-aware repair may preserve already-valid bullets.  When the
    // caller has no field map (speech-alignment repair), the existing visible
    // projection is not trusted and must be rebuilt from accepted narration.
    const preserveExistingBullets = Boolean(affectedFields)
      && !bulletFieldAffected
      && existingBullets.length > 0;
    const repairedBullets = preserveExistingBullets ? existingBullets : narrationBullets;
    const compactBullets = slide.slideKind === "title" ? [] : repairedBullets;
    const visualDescription = candidates.find((candidate, index) => index > 0
      && !semanticallyRepeats(candidate, thesis)
      && !compactBullets.some((bullet) => semanticallyRepeats(candidate, bullet))) || "";
    const visual = {
      ...slide.visual,
      title: needsField("visual.title") ? "" : slide.visual.title,
      description: needsField("visual.description") ? visualDescription : slide.visual.description,
      leftLabel: needsField("visual") || affectedFields?.has("duplicate") ? "" : slide.visual.leftLabel,
      rightLabel: needsField("visual") || affectedFields?.has("duplicate") ? "" : slide.visual.rightLabel,
      // Do not mirror repaired bullets into visual labels: those labels are
      // inspected as visible text and were producing the same duplicate again.
      items: needsField("visual") || affectedFields?.has("duplicate") ? [] : slide.visual.items,
      rows: needsField("visual") || affectedFields?.has("duplicate") ? [] : slide.visual.rows,
    };
    return {
      ...slide,
      title: needsField("title") ? title : slide.title,
      thesis: needsField("thesis") ? thesis : slide.thesis,
      bullets: needsField("bullets") ? compactBullets.slice(0, 3) : slide.bullets,
      blocks: needsField("blocks") ? [] : slide.blocks,
      definition: slide.definition && (needsField("definition") || replaceAllVisible)
        ? (compactBullets.find((bullet) => !semanticallyRepeats(bullet, thesis)) ? { term: compactTitle(title), text: compactBullets.find((bullet) => !semanticallyRepeats(bullet, thesis))! } : null)
        : slide.definition,
      visual: needsField("visual") ? visual : slide.visual,
      // Speaker notes are accepted evidence-reviewed narration and must remain canonical.
      speakerNotes: slide.speakerNotes,
    };
  });
  const speechScript = presentation.speechScript.map((item) => {
    const slide = slides.find((candidate) => candidate.order === item.slideOrder);
    return slide ? { ...item, slideTitle: slide.title, text: slide.speakerNotes } : item;
  });
  return presentationSchema.parse({ ...presentation, outline: slides.map((slide) => slide.title), slides, speechScript });
}

/**
 * Restores whichever projection of accepted narration is damaged.  Visible
 * copy is repaired through the existing compact-screen-text fallback; notes,
 * script ordering and the accepted generatedText itself are never rewritten
 * to fit leaked screen text.
 */
export function applySlideSpeechAlignmentFallbacks(
  presentation: PresentationDocument,
  issues: QualityIssue[],
  project: QualityProjectInput,
): PresentationDocument {
  const visibleIssues = issues.filter((issue) =>
    (issue.category === "off_topic" || issue.category === "generic_text")
    && issue.field === "visibleText",
  );
  const visibleRepaired = visibleIssues.length
    ? rebuildVisibleContentFromAcceptedNarration(
        presentation,
        new Set(visibleIssues.map((issue) => issue.slideId).filter((id): id is string => Boolean(id))),
        project,
      )
    : presentation;
  const acceptedByOrder = new Map(parseAcceptedNarrationSections(visibleRepaired.generatedText)
    .map((section) => [section.order, section]));
  if (acceptedByOrder.size !== visibleRepaired.slides.length) return visibleRepaired;

  const slides = visibleRepaired.slides.map((slide) => {
    const accepted = acceptedByOrder.get(slide.order);
    return accepted ? { ...slide, speakerNotes: accepted.text } : slide;
  });
  const speechScript = slides.map((slide) => ({
    slideOrder: slide.order,
    slideTitle: slide.title,
    text: acceptedByOrder.get(slide.order)?.text || slide.speakerNotes,
  }));
  return presentationSchema.parse({
    ...visibleRepaired,
    outline: slides.map((slide) => slide.title),
    slides,
    speechScript,
  });
}

function keepsExpectedNarrationSections(value: string, presentation: PresentationDocument) {
  if (!value) return false;
  const current = countNarrationSections(presentation.generatedText);
  const next = countNarrationSections(value);
  return next >= Math.max(1, current);
}

function countNarrationSections(value: unknown) {
  return cleanMultilineText(value).match(/(?:^|\n)Слайд\s+\d+\s*:/gi)?.length || 0;
}

function collectSlideTextEntries(presentation: PresentationDocument): QualityTextEntry[] {
  return presentation.slides.flatMap((slide) => [
    { slide, field: "title", value: slide.title },
    { slide, field: "thesis", value: slide.thesis },
    { slide, field: "speakerNotes", value: slide.speakerNotes },
    ...slide.bullets.map((value, index) => ({ slide, field: `bullets.${index}`, value })),
    ...slide.blocks.flatMap((block, index) =>
      block.type === "bullets"
        ? block.items.map((value, itemIndex) => ({ slide, field: `blocks.${index}.items.${itemIndex}`, value }))
        : [{ slide, field: `blocks.${index}.content`, value: block.content }],
    ),
    ...(slide.definition ? [
      { slide, field: "definition.term", value: slide.definition.term },
      { slide, field: "definition.text", value: slide.definition.text },
    ] : []),
    { slide, field: "visual.title", value: slide.visual.title },
    { slide, field: "visual.description", value: slide.visual.description },
    ...slide.visual.items.flatMap((item, index) => [
      { slide, field: `visual.items.${index}.label`, value: item.label },
      { slide, field: `visual.items.${index}.text`, value: item.text },
    ]),
    ...slide.visual.rows.flatMap((row, index) => [
      { slide, field: `visual.rows.${index}.label`, value: row.label },
      { slide, field: `visual.rows.${index}.left`, value: row.left },
      { slide, field: `visual.rows.${index}.right`, value: row.right },
    ]),
  ]);
}

function parseQualityCritique(value: unknown): QualityCritique {
  const parsed = value && typeof value === "object" ? value as Partial<QualityCritique> : {};
  const issues = Array.isArray(parsed.issues) ? parsed.issues.filter(isQualityIssue) : [];
  const score = typeof parsed.score === "number" ? parsed.score : scoreFromIssues(issues);
  return {
    score: clamp(score, 0, 100),
    summary: cleanText(parsed.summary) || "Model critique returned quality issues.",
    dimensions: parseQualityDimensions(parsed.dimensions),
    issues,
    passed: Boolean(parsed.passed ?? score >= QUALITY_SCORE_THRESHOLD),
  };
}

function isQualityIssue(value: unknown): value is QualityIssue {
  if (!value || typeof value !== "object") return false;
  const issue = value as QualityIssue;
  return ["blocker", "major", "minor"].includes(issue.severity)
    && ["generic_text", "off_topic", "too_long", "duplicate", "bad_narration", "bad_visual", "factual_risk", "schema_risk"].includes(issue.category)
    && typeof issue.message === "string";
}

function mergeCritiques(left: QualityCritique, right: QualityCritique): QualityCritique {
  const issues = dedupeIssues([...left.issues, ...right.issues]);
  const score = Math.min(left.score, right.score, scoreFromIssues(issues));
  return {
    score,
    summary: right.summary || left.summary,
    dimensions: mergeDimensions(left.dimensions, right.dimensions),
    issues,
    passed: score >= QUALITY_SCORE_THRESHOLD && !issues.some((issue) => issue.severity === "blocker"),
  };
}

function scoreQualityDimensions(
  presentation: PresentationDocument,
  sources: Source[],
  project?: QualityProjectInput,
): QualityDimensions {
  return {
    speechNaturalness: scoreSpeechNaturalness(presentation),
    universityTone: scoreUniversityTone(presentation, project),
    slideBrevity: scoreSlideBrevity(presentation),
    visualRhythm: scoreVisualRhythm(presentation),
    sourceGrounding: scoreSourceGrounding(presentation, sources),
    exportReadiness: scoreExportReadiness(presentation),
  };
}

function parseQualityDimensions(value: unknown): QualityDimensions | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<Record<keyof QualityDimensions, unknown>>;
  const keys = qualityDimensionNames();
  if (!keys.every((key) => candidate[key] && typeof candidate[key] === "object")) return undefined;
  return Object.fromEntries(keys.map((key) => {
    const item = candidate[key] as Partial<QualityDimensionScore>;
    return [key, dimension(clamp(Number(item.score) || 0, 0, 100), cleanText(item.reason))];
  })) as QualityDimensions;
}

function mergeDimensions(left?: QualityDimensions, right?: QualityDimensions): QualityDimensions | undefined {
  if (!left) return right;
  if (!right) return left;
  return Object.fromEntries(qualityDimensionNames().map((key) => [
    key,
    right[key].score < left[key].score ? right[key] : left[key],
  ])) as QualityDimensions;
}

function targetedRepairIssues(critique: QualityCritique) {
  const weak = new Set(weakestDimensionNames(critique));
  const categoryByDimension: Record<keyof QualityDimensions, QualityIssue["category"][]> = {
    speechNaturalness: ["bad_narration"],
    universityTone: ["off_topic", "generic_text"],
    slideBrevity: ["too_long"],
    visualRhythm: ["bad_visual", "duplicate"],
    sourceGrounding: ["factual_risk"],
    exportReadiness: ["schema_risk"],
  };
  const categories = new Set([...weak].flatMap((name) => categoryByDimension[name]));
  const targeted = critique.issues.filter((issue) => categories.has(issue.category) || issue.severity === "blocker");
  return targeted.length ? targeted : critique.issues;
}

export function rebuildGeneratedCanvases(presentation: PresentationDocument): PresentationDocument {
  const theme = resolvePresentationTheme({
    title: presentation.title,
    scenario: presentation.scenario,
    level: presentation.level,
    presentationTheme: presentation.presentationTheme,
    designBrief: presentation.designBrief,
  });
  const customCanvases = new Map(presentation.slides
    .filter((slide) => hasCustomSlideCanvas(slide, theme))
    .map((slide) => [slide.id, slide.canvas]));
  const rebuilt = ensureEditableCanvas(presentation);
  return presentationSchema.parse({
    ...rebuilt,
    slides: rebuilt.slides.map((slide) => customCanvases.has(slide.id)
      ? { ...slide, canvas: customCanvases.get(slide.id) }
      : slide),
  });
}

function rebuildTopicRepairedCanvases(presentation: PresentationDocument, affectedSlideIds: Set<string>): PresentationDocument {
  if (!affectedSlideIds.size) return presentation;
  // Repairs can normalize shared presentation fields in addition to the slide
  // named by an issue. Rebuild every generated canvas, while preserving custom
  // canvases, to keep the released document canonical for export.
  return rebuildGeneratedCanvases(presentation);
}

function weakestDimensionNames(critique: QualityCritique): Array<keyof QualityDimensions> {
  if (!critique.dimensions) return [];
  const entries = qualityDimensionNames().map((name) => [name, critique.dimensions![name].score] as const);
  return entries.filter(([, score]) => score < WEAK_DIMENSION_THRESHOLD).map(([name]) => name);
}

function weakestDimensionScore(critique: QualityCritique) {
  return critique.dimensions
    ? Math.min(...qualityDimensionNames().map((name) => critique.dimensions![name].score))
    : 100;
}

function dimensionScoresRecord(dimensions?: QualityDimensions) {
  return dimensions
    ? Object.fromEntries(qualityDimensionNames().map((name) => [name, dimensions[name].score]))
    : {};
}

function averageDimensionScore(dimensions: QualityDimensions) {
  return Math.round(qualityDimensionNames().reduce((sum, name) => sum + dimensions[name].score, 0) / qualityDimensionNames().length);
}

function qualityDimensionNames(): Array<keyof QualityDimensions> {
  return ["speechNaturalness", "universityTone", "slideBrevity", "visualRhythm", "sourceGrounding", "exportReadiness"];
}

function dedupeIssues(issues: QualityIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [issue.slideId || "", issue.category, issue.field || "", normalizeQualityText(issue.message)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreFromIssues(issues: QualityIssue[]) {
  return Math.max(
    0,
    100 - issues.reduce((total, issue) => total + (issue.severity === "blocker" ? 35 : issue.severity === "major" ? 15 : 6), 0),
  );
}

function issueCountsByCategory(issues: QualityIssue[]) {
  return Object.entries(issueCountsRecord(issues)).map(([category, count]) => `${category}:${count}`).join(", ");
}

function issueCountsRecord(issues: QualityIssue[]) {
  return issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.category] = (counts[issue.category] || 0) + 1;
    return counts;
  }, {});
}

function slideMeaningTokens(slide: Slide) {
  return significantTokens([slide.title, slide.thesis, ...slide.bullets, slide.speakerNotes].join(" "));
}

function significantTokens(value: string) {
  return topicTokens(value);
}

function topicTokens(value: string) {
  return normalizeQualityText(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .map(topicStem)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function semanticOverlap(left: string, right: string) {
  const leftTokens = uniqueTokens(topicTokens(left));
  const rightTokens = uniqueTokens(topicTokens(right));
  if (!leftTokens.length || !rightTokens.length) return 0;
  return overlapCount(leftTokens, rightTokens) / Math.min(leftTokens.length, rightTokens.length);
}

/**
 * Final persisted-canvas gate. This is intentionally independent from the
 * provider/content quality critique: every recovery variant must pass it
 * immediately before the document is allowed to become ready.
 */
export function finalCanvasSafetyIssues(presentation: PresentationDocument) {
  return presentation.slides.flatMap((slide) =>
    (slide.canvas ? auditSlideCanvas(slide.canvas) : ["canvas is missing"])
      .map((issue) => `slide ${slide.order}: ${issue}`),
  );
}

function uniqueRecoveryBullets(values: string[], title: string, thesis: string) {
  const result: string[] = [];
  for (const value of values) {
    const bullet = cleanText(value);
    if (!bullet
      || semanticallyRepeats(bullet, title)
      || semanticallyRepeats(bullet, thesis)
      || isLowInformationProjection(bullet)
      || hasMetaSlideLanguage(bullet)
      || visibleTextIntegrityReason(bullet, false)
      || result.some((existing) => semanticallyRepeats(existing, bullet))) {
      continue;
    }
    result.push(bullet);
    if (result.length === 3) break;
  }
  return result;
}

function semanticallyRepeats(left: string, right: string) {
  const leftKey = normalizedMessage(left);
  const rightKey = normalizedMessage(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const shorter = leftKey.length < rightKey.length ? leftKey : rightKey;
  const longer = leftKey.length < rightKey.length ? rightKey : leftKey;
  if (shorter.length >= 18 && longer.includes(shorter) && topicTokens(shorter).length >= 3) return true;
  const leftTokens = uniqueTokens(topicTokens(leftKey));
  const rightTokens = uniqueTokens(topicTokens(rightKey));
  return Math.min(leftTokens.length, rightTokens.length) >= 3
    && semanticOverlap(leftKey, rightKey) >= 0.78;
}

function parseAcceptedNarrationSections(value: string) {
  const text = cleanMultilineText(value);
  const sections: Array<{ order: number; title: string; text: string }> = [];
  const header = /(?:^|\n)\s*(?:slide|слайд)\s+(\d+)\s*:\s*([^\n]+)\n([\s\S]*?)(?=(?:\n\s*(?:slide|слайд)\s+\d+\s*:)|$)/giu;
  for (const match of text.matchAll(header)) {
    const order = Number(match[1]);
    const title = cleanText(match[2]);
    const narration = cleanText(match[3]);
    if (order > 0 && title && narration) sections.push({ order, title, text: narration });
  }
  return sections;
}

function topicStem(token: string) {
  const normalized = token.replace(/ё/g, "е");
  if (/^[а-я]+$/u.test(normalized) && normalized.length >= 7) {
    return normalized.replace(/(?:иями|ями|ами|ого|ему|ыми|ими|иях|иях|ость|ости|ение|ения|ений|овать|ировать|ского|скому|ская|ские|ный|ная|ные|ами|ями|ах|ях|ов|ев|ом|ем|ой|ий|ый|ая|ое|ие|ы|и|а|я|у|ю|е)$/u, "") || normalized;
  }
  return normalized.replace(/(?:ing|tion|ions|ment|ments|ed|es|s)$/u, "");
}

function uniqueTokens(tokens: string[]) {
  return [...new Set(tokens)];
}

function matchesAny(token: string, candidates: string[]) {
  return candidates.some((candidate) => candidate === token || (candidate.length >= 5 && token.length >= 5 && (candidate.startsWith(token) || token.startsWith(candidate))));
}

function overlapCount(left: string[], right: string[]) {
  return left.filter((token) => matchesAny(token, right)).length;
}

function pickBriefText(value: Record<string, unknown>, fields: string[]) {
  return fields.flatMap((field) => {
    const item = value[field];
    return Array.isArray(item) ? item.map((entry) => String(entry || "")) : typeof item === "string" ? [item] : [];
  });
}

function visibleSlideText(slide: Slide) {
  return [
    slide.title,
    slide.thesis,
    ...slide.bullets,
    ...slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : [block.content]),
    slide.definition?.term || "",
    slide.definition?.text || "",
    slide.visual.title,
    ...slide.visual.items.flatMap((item) => [item.label, item.text]),
    ...slide.visual.rows.flatMap((row) => [row.label, row.left, row.right]),
  ].join(" ");
}

function foreignDomainSignalCount(text: string) {
  const normalized = normalizeQualityText(text);
  const clusters = [
    ["международ", "напряж", "лидер", "переговор", "дипломат", "миров", "эскалац", "сверхдержав"],
    ["клетк", "фотосинт", "организм", "генет", "биолог"],
    ["инфляц", "безработ", "валют", "центробанк", "бюджет"],
  ];
  return Math.max(0, ...clusters.map((cluster) => cluster.filter((signal) => normalized.includes(signal)).length));
}

function acceptedNarrationSentences(values: string[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => cleanText(value).split(/(?<=[.!?])\s+/))
    .map((sentence) => cleanText(sentence))
    .filter((sentence) => sentence.split(/\s+/).length >= 4)
    .filter((sentence) => {
      const key = normalizeQualityText(sentence);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function compactTitle(value: string) {
  return cleanText(value).replace(/[.!?]+$/g, "").split(/\s+/).slice(0, 12).join(" ") || "Ключевой вывод";
}

/** A generic accepted heading may be retained in narration, but it is not a useful screen label. */
function compactAcceptedNarrationTitle(sectionTitle: string, sentences: string[]) {
  const title = compactTitle(sectionTitle);
  return isGenericTitle(title) ? compactTitle(sentences[0] || sectionTitle) : title;
}

function compactSentence(value: string, maxWords: number) {
  const words = cleanText(value).replace(/[.!?]+$/g, "").split(/\s+/).filter(Boolean).slice(0, maxWords);
  return words.length ? `${words.join(" ")}.` : "";
}

function uniqueCompactSentences(values: string[], thesis: string) {
  const thesisKey = normalizeQualityText(thesis);
  const seen = new Set<string>([thesisKey]);
  return values.map((value) => compactSentence(value, 18)).filter((value) => {
    const key = normalizeQualityText(value);
    if (!key || seen.has(key) || value.split(/\s+/).length < 4 || [...seen].some((candidate) => candidate && semanticallyRepeats(value, candidate))) return false;
    seen.add(key);
    return true;
  });
}

function isLowInformationProjection(value: string) {
  if (hasGenericOrMetaScreenText(value)) return true;
  return /(?:\u0438\u0433\u0440\u0430\u0435\u0442\s+\u0432\u0430\u0436\u043d\u0443\u044e\s+\u0440\u043e\u043b\u044c|\u043e\u0448\u0438\u0431\u043a\u0438\s+\u0432\u044b\u044f\u0432\u043b\u044f\u044e\u0442\u0441\u044f\s+\u0440\u0430\u043d\u044c\u0448\u0435|\u0441\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u044f\s+\u043e\u0431\u0443\u0447\u0435\u043d\u0438\u044f\s+\u0443\u0442\u043e\u0447\u043d\u044f\u0435\u0442\u0441\u044f)/iu.test(value);
}

type VisibleTextIntegrityEntry = {
  field: string;
  value: string;
  label: boolean;
};

function visibleTextIntegrityEntries(slide: Slide): VisibleTextIntegrityEntry[] {
  return [
    { field: "title", value: slide.title, label: true },
    { field: "thesis", value: slide.thesis, label: false },
    ...slide.bullets.map((value, index) => ({ field: `bullets.${index}`, value, label: false })),
    ...slide.blocks.flatMap((block, index) => block.type === "bullets"
      ? block.items.map((value, itemIndex) => ({ field: `blocks.${index}.items.${itemIndex}`, value, label: false }))
      : [{ field: `blocks.${index}.content`, value: block.content, label: false }]),
    ...(slide.definition ? [
      { field: "definition.term", value: slide.definition.term, label: true },
      { field: "definition.text", value: slide.definition.text, label: false },
    ] : []),
    { field: "visual.title", value: slide.visual.title, label: true },
    ...slide.visual.items.flatMap((item, index) => [
      { field: `visual.items.${index}.label`, value: item.label, label: true },
      { field: `visual.items.${index}.text`, value: item.text, label: false },
    ]),
    ...slide.visual.rows.flatMap((row, index) => [
      { field: `visual.rows.${index}.label`, value: row.label, label: true },
      { field: `visual.rows.${index}.left`, value: row.left, label: false },
      { field: `visual.rows.${index}.right`, value: row.right, label: false },
    ]),
    { field: "visual.leftLabel", value: slide.visual.leftLabel, label: true },
    { field: "visual.rightLabel", value: slide.visual.rightLabel, label: true },
  ];
}

function visibleTextIntegrityReason(value: string, label: boolean): string {
  const text = cleanText(value);
  // Visual labels and optional presentation fields may be intentionally empty.
  if (!text) return "";
  if (/(?:…|\.\.\.)\s*$/.test(text)) return "ends with truncated text";
  if (hasUnclosedPairedMarks(text)) return "unclosed quotation mark or bracket";
  if (label) return "";
  const words = text.split(/\s+/).filter(Boolean);
  if (endsWithDanglingConnector(text)) return "ends with a dangling connector";
  if (startsWithDependentFragment(text)) return "starts as a continuation from another slot";
  if (endsWithKnownDanglingPredicate(text)) return "ends with an incomplete predicate";
  if (words.length <= 3 && isClearlyIncompleteShortText(text)) return "too short to form an independent statement";
  return "";
}

function endsWithDanglingConnector(value: string) {
  return /(?:^|[^\p{L}])(?:in|on|at|to|and|or|but|for|with|of|by|from|в|на|и|но|для|к|с|из|от|по|о)\s*[.!?…]*$/iu.test(value);
}

function startsWithDependentFragment(value: string) {
  return /^(?:continuing|including|based\s+on|which|that|because|while|although|продолжая|включая|основываясь|котор(?:ый|ая|ое|ые)|поскольку|так\s+как|если|чтобы)(?:\s|,)/iu.test(cleanText(value));
}

function endsWithKnownDanglingPredicate(value: string) {
  const normalized = cleanText(value).replace(/[.!?…]+$/g, "").toLocaleLowerCase();
  return /(?:\b(?:shows|showed|demonstrates|demonstrated|explains|explained|allows|allowed|remains|became|becomes|is|are|was|were|will|can|could|may|might|should|has|have|had)|(?:показал|показывает|объясняет|позволит|позволяет|остается|остался|стал|стала|является))$/iu.test(normalized);
}

function isClearlyIncompleteShortText(value: string) {
  const normalized = cleanText(value).toLocaleLowerCase();
  return /^(?:and|or|but|because|which|that|to|of|for|with|в|на|и|но|для|к|с|из|от|по|о)(?:\s|$)/iu.test(normalized)
    || endsWithKnownDanglingPredicate(normalized);
}

function hasUnclosedPairedMarks(value: string) {
  const pairs: Array<[string, string]> = [["(", ")"], ["[", "]"], ["{", "}"], ["«", "»"]];
  if (pairs.some(([open, close]) => [...value].filter((char) => char === open).length !== [...value].filter((char) => char === close).length)) return true;
  const doubleQuotes = [...value].filter((char) => char === '"').length;
  return doubleQuotes % 2 !== 0;
}

function normalizedMessage(value: string) {
  return normalizeQualityText(value)
    .replace(/^(?:overall|in summary|it is important to note that|важно отметить что|в целом|итак)\s+/iu, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function deckMessageTokens(slide: Slide) {
  return uniqueTokens(
    cleanText([slide.title, slide.thesis, ...slide.bullets, ...slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : [block.content])].join(" "))
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu)?.filter((token) => (token.length >= 4 || /^\d{4}$/.test(token)) && !STOP_WORDS.has(token)) || [],
  );
}

function jaccardSimilarity(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (!leftSet.size || !rightSet.size) return 0;
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  return intersection / new Set([...leftSet, ...rightSet]).size;
}

function hasPreciseFact(value: string) {
  return /(?:^|[^\p{L}\p{N}])(?:\d{4}|\d{1,3}(?:[.,]\d+)?\s*(?:%|\u043c\u043b\u043d|\u043c\u043b\u0440\u0434|\u043b\u0435\u0442|\u0433\u043e\u0434(?:\u0430|\u043e\u0432)?))(?=$|[^\p{L}\p{N}])/iu.test(value);
}

function isGenericRealPhotoPrompt(value: string) {
  const normalized = normalizeQualityText(value);
  if (!normalized) return true;
  if (/\b(?:educational|presentation|generic|abstract|stock|high quality|realistic|editorial|opening)\s+(?:image|photo|visual|picture)\b/i.test(normalized)) return true;
  if (/\b(?:image|photo|visual|picture)\s+for\b/i.test(normalized)) return true;
  if (/(?:РѕР±СЂР°Р·РѕРІР°С‚РµР»СЊРЅ|РїСЂРµР·РµРЅС‚Р°С†|СЃР»Р°Р№Рґ|РєР°С‡РµСЃС‚РІРµРЅРЅ|СЂРµР°Р»РёСЃС‚РёС‡РЅ)\s+(?:РёР·РѕР±СЂР°Р¶РµРЅ|С„РѕС‚Рѕ|РєР°СЂС‚РёРЅ|РІРёР·СѓР°Р»)/iu.test(normalized)) return true;
  const words = normalized.split(/\s+/).filter((word) => !/^(?:a|an|the|of|for|and|or|photo|image|visual|picture|documentary|authentic|real|realistic|clear|editorial)$/.test(word));
  return words.length < 3;
}

function sentenceStarts(value: string) {
  return cleanText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeQualityText(sentence).split(/\s+/).slice(0, 3).join(" "))
    .filter((start) => start.split(/\s+/).length >= 3)
    // A connective such as "Then appears" only marks internal sequencing;
    // it is not a reusable topical claim and should not reject accepted speech.
    .filter((start) => !/^(?:then appears|затем появляется)\b/iu.test(start));
}

function wordCount(value: string) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function dimension(score: number, reason: string): QualityDimensionScore {
  return { score: clamp(Math.round(score), 0, 100), reason };
}

function ratioPenalty(count: number, total: number, maximum: number) {
  return total > 0 ? Math.min(maximum, (count / total) * maximum) : 0;
}

function normalizeQualityText(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .replace(/["'`.,!?;:()[\]{}<>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMultilineText(value: unknown) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isDemoProvider(provider: GenerationMode) {
  return provider === "demo" || provider === "demo-fallback";
}
