import {
  auditSlideCanvas,
  ensureEditableCanvas,
  hasCustomSlideCanvas,
  presentationSchema,
  resolvePresentationTheme,
  type PresentationDocument,
  type QualityCritique,
  type QualityDimensionScore,
  type QualityDimensions,
  type QualityIssue,
  type Slide,
  type Source,
} from "@studydeck/shared";
import { errorLogFields, logger } from "../observability.js";

export type QualityProjectInput = {
  id: string;
  title: string;
  prompt: string;
  scenario: string;
  level: string;
  mode: string;
  slideCount: number;
};

export type GenerationMode = "openai" | "yandex" | "demo" | "demo-fallback";

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

type QualityTextEntry = {
  slide: Slide;
  field: string;
  value: string;
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

export function isVisibleTextTooLong(slide: Slide) {
  const visibleText = [slide.title, slide.thesis, ...slide.bullets, ...slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : [block.content])].join(" ");
  return wordCount(slide.title) > 12
    || slide.title.length > 90
    || sentenceCount(slide.thesis) > 1
    || wordCount(slide.thesis) > 28
    || slide.thesis.length > 220
    || wordCount(visibleText) > 78
    || sentenceCount(visibleText) > 7
    || slide.bullets.some((bullet) => wordCount(bullet) > 18 || bullet.length > 130)
    || slide.blocks.some((block) => {
      const values = block.type === "bullets" ? block.items : [block.content];
      return values.some((value) => wordCount(value) > 22 || value.length > 160);
    });
}

export function hasWeakConclusion(slide: Slide, project: QualityProjectInput) {
  if (slide.order !== project.slideCount && slide.slideKind !== "summary") return false;
  const text = normalizeQualityText([slide.title, slide.thesis, ...slide.bullets, slide.speakerNotes].join(" "));
  const topicTokens = significantTokens(`${project.title} ${project.prompt}`).slice(0, 8);
  const conclusionWords = ["вывод", "итог", "значит", "поэтому", "важно", "conclusion", "result"];
  const hasTopic = topicTokens.length === 0 || topicTokens.some((token) => text.includes(token));
  const hasConclusion = conclusionWords.some((word) => text.includes(normalizeQualityText(word)));
  return !hasTopic || !hasConclusion || wordCount(slide.speakerNotes) < 35;
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
  const textOnlySlides = presentation.slides.filter((slide) =>
    slide.visual.type === "none" || (!slide.visual.description && !slide.visual.image && !slide.visual.items.length && !slide.visual.rows.length),
  ).length;
  const layouts = new Set(presentation.slides.map((slide) => slide.layout)).size;
  let penalty = Math.min(35, layoutIssues * 12);
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
  const unsupported = presentation.slides.filter((slide) =>
    hasUnsupportedSpecificity([slide.title, slide.thesis, ...slide.bullets, slide.speakerNotes].join(" "), sources),
  ).length;
  const preciseSlides = presentation.slides.filter((slide) =>
    hasPreciseFact([slide.title, slide.thesis, ...slide.bullets, slide.speakerNotes].join(" ")),
  ).length;
  const unreferenced = sources.length
    ? presentation.slides.filter((slide) => hasPreciseFact([slide.thesis, ...slide.bullets].join(" ")) && !slide.sourceRefs.length).length
    : 0;
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

export function findLongSlideTextIssues(presentation: PresentationDocument): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const slide of presentation.slides) {
    if (!isVisibleTextTooLong(slide)) continue;
    if (wordCount(slide.title) > 12 || slide.title.length > 90) {
      issues.push(longIssue(slide, "title", "Slide title is too long."));
    }
    if (sentenceCount(slide.thesis) > 1 || wordCount(slide.thesis) > 28 || slide.thesis.length > 220) {
      issues.push(longIssue(slide, "thesis", "Slide thesis must be one compact sentence."));
    }
    slide.bullets.forEach((bullet, index) => {
      if (wordCount(bullet) > 18 || bullet.length > 130) {
        issues.push(longIssue(slide, `bullets.${index}`, "Bullet is too long for slide text."));
      }
    });
    slide.blocks.forEach((block, index) => {
      const values = block.type === "bullets" ? block.items : [block.content];
      values.forEach((value, itemIndex) => {
        if (wordCount(value) > 22 || value.length > 160) {
          issues.push(longIssue(slide, block.type === "bullets" ? `blocks.${index}.items.${itemIndex}` : `blocks.${index}.content`, "Block text is too dense."));
        }
      });
    });
  }
  return issues;
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
  return presentation.slides.flatMap((slide) => {
    const text = [slide.title, slide.thesis, ...slide.bullets, slide.speakerNotes].join(" ");
    if (!hasUnsupportedSpecificity(text, sources)) return [];
    return [{
      slideId: slide.id,
      severity: "minor" as const,
      category: "factual_risk" as const,
      message: "Precise dates, names, or numbers appear without source material.",
      repairInstruction: "Keep unsupported claims general or attach source-backed references.",
    }];
  });
}

export function findWeakConclusionIssues(presentation: PresentationDocument, project: QualityProjectInput): QualityIssue[] {
  return presentation.slides.flatMap((slide) => {
    if (!hasWeakConclusion(slide, project)) return [];
    return [{
      slideId: slide.id,
      severity: "major" as const,
      category: "bad_narration" as const,
      field: "speakerNotes",
      message: "Final slide conclusion is too generic or not tied to the project topic.",
      repairInstruction: "Rewrite the final slide with a topic-specific human conclusion and concrete takeaways.",
    }];
  });
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

export function findExportReadinessIssues(presentation: PresentationDocument): QualityIssue[] {
  return presentation.slides.flatMap((slide) => {
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
      field: "canvas",
      message: "The slide canvas is missing or unsafe for export.",
      repairInstruction: "Rebuild the generated canvas without changing a user-edited custom canvas.",
    }];
  });
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
  const issues = dedupeIssues([
    ...findGenericTextIssues(presentation),
    ...findRepeatedTitleIssues(presentation),
    ...findLongSlideTextIssues(presentation),
    ...findNarrationMetaIssues(presentation),
    ...findLayoutRhythmIssues(presentation),
    ...findVisualDescriptionIssues(presentation),
    ...findDuplicateSlideIssues(presentation),
    ...findRepeatedSentenceStartIssues(presentation),
    ...findFactualRiskIssues(presentation, sources),
    ...(project ? findWeakConclusionIssues(presentation, project) : []),
    ...findUniversityToneIssues(presentation, project),
    ...findShortNarrationIssues(presentation),
    ...findExportReadinessIssues(presentation),
  ]);
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
  let best = presentationSchema.parse(presentation);
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
        applyQualityRepairs(best, await options.repair(best, targetedRepairIssues(bestCritique), attempts)),
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

export function applyQualityRepairs(presentation: PresentationDocument, rawRepairs: unknown): PresentationDocument {
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
          visual: repair.visual ? { ...slide.visual, ...repair.visual } : slide.visual,
          speakerNotes: cleanText(repair.speakerNotes) || slide.speakerNotes,
          sourceRefs: Array.isArray(repair.sourceRefs) ? repair.sourceRefs : slide.sourceRefs,
        };
      })
    : presentation.slides;

  const requestedSpeechScript = Array.isArray(response.speechScript) ? response.speechScript : [];
  const speechScript = presentation.speechScript.map((item) => {
    const slide = slides.find((candidate) => candidate.order === item.slideOrder);
    const requested = requestedSpeechScript.find((candidate: any) => Number(candidate?.slideOrder) === item.slideOrder);
    return slide ? { ...item, ...(requested || {}), slideOrder: item.slideOrder, slideTitle: slide.title, text: slide.speakerNotes } : item;
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

function longIssue(slide: Slide, field: string, message: string): QualityIssue {
  return {
    slideId: slide.id,
    severity: field === "title" || field === "thesis" ? "major" : "minor",
    category: "too_long",
    field,
    message,
    repairInstruction: "Shorten this field without losing its concrete meaning.",
  };
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

function rebuildGeneratedCanvases(presentation: PresentationDocument): PresentationDocument {
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
  return normalizeQualityText(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token.length >= 4);
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

function sentenceCount(value: string) {
  return cleanText(value).split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).length;
}

function sentenceStarts(value: string) {
  return cleanText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeQualityText(sentence).split(/\s+/).slice(0, 3).join(" "))
    .filter((start) => start.split(/\s+/).length >= 3);
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
