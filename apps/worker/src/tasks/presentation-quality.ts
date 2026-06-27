import {
  presentationSchema,
  type PresentationDocument,
  type QualityCritique,
  type QualityIssue,
  type Slide,
  type Source,
} from "@studydeck/shared";

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

export const BANNED_QUALITY_PHRASES = [
  "\u043d\u0430 \u044d\u0442\u043e\u043c \u0441\u043b\u0430\u0439\u0434\u0435",
  "\u044d\u0442\u043e\u0442 \u0441\u043b\u0430\u0439\u0434",
  "\u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u0440\u0430\u0441\u043a\u0440\u044b\u0432\u0430\u0435\u0442\u0441\u044f",
  "\u0433\u043b\u0430\u0432\u043d\u0430\u044f \u0438\u0434\u0435\u044f \u0441\u0432\u044f\u0437\u0430\u043d\u0430",
  "\u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442, \u043f\u0440\u0438\u0447\u0438\u043d\u044b \u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u0441\u0442\u0432\u0438\u044f",
  "\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0440\u0430\u0437\u0434\u0435\u043b",
  "\u043f\u0435\u0440\u0435\u0445\u043e\u0434",
  "\u043e\u043f\u043e\u0440\u043d\u044b\u0435 \u043f\u0443\u043d\u043a\u0442\u044b",
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
  return wordCount(slide.title) > 12
    || slide.title.length > 90
    || sentenceCount(slide.thesis) > 1
    || wordCount(slide.thesis) > 28
    || slide.thesis.length > 220
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
  return presentation.slides.flatMap((slide) => {
    const description = normalizeQualityText(slide.visual.description);
    if (description && description.split(" ").length >= 4 && !BANNED_QUALITY_PHRASES.some((phrase) => description.includes(normalizeQualityText(phrase)))) {
      return [];
    }
    return [{
      slideId: slide.id,
      severity: slide.visual.type === "none" ? "minor" : "major",
      category: "bad_visual" as const,
      field: "visual.description",
      message: "Visual description is missing, too generic, or not searchable.",
      repairInstruction: "Describe a concrete searchable visual tied to this slide topic.",
    }];
  });
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

export function scorePresentationQuality(presentation: PresentationDocument, issues: QualityIssue[]): QualityCritique {
  const penalty = issues.reduce((total, issue) => total + (issue.severity === "blocker" ? 35 : issue.severity === "major" ? 15 : 6), 0);
  const score = Math.max(0, 100 - penalty);
  const summary = issues.length
    ? `${issues.length} quality issue(s): ${issueCountsByCategory(issues)}.`
    : "No quality issues found.";
  return {
    score,
    summary,
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
  ]);
  return scorePresentationQuality(presentation, issues);
}

export function shouldRunModelCritic(critique: QualityCritique, presentation: PresentationDocument, sources: Source[]) {
  return critique.issues.some((issue) => issue.severity === "blocker")
    && (critique.score < QUALITY_SCORE_THRESHOLD || presentation.slides.length > 4 || sources.length === 0);
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
  let modelCritique = bestCritique;

  if (!isDemoProvider(provider) && options.critique && shouldRunModelCritic(bestCritique, best, sources)) {
    try {
      modelCritique = mergeCritiques(bestCritique, parseQualityCritique(await options.critique(best, bestCritique)));
      bestCritique = modelCritique.score < bestCritique.score ? modelCritique : bestCritique;
    } catch (error) {
      console.warn("presentation quality model critique failed:", error);
    }
  }

  const beforeScore = bestCritique.score;
  let attempts = 0;
  const maxAttempts = options.maxRepairAttempts ?? MAX_DEFAULT_REPAIR_ATTEMPTS;
  while (
    !isDemoProvider(provider)
    && options.repair
    && bestCritique.score < QUALITY_SCORE_THRESHOLD
    && bestCritique.issues.some((issue) => issue.severity === "blocker")
    && attempts < maxAttempts
  ) {
    attempts += 1;
    try {
      const repaired = applyQualityRepairs(best, await options.repair(best, bestCritique.issues, attempts));
      const parsed = presentationSchema.parse(repaired);
      const repairedCritique = critiquePresentationDeterministically(parsed, sources, project);
      if (repairedCritique.score >= bestCritique.score) {
        best = parsed;
        bestCritique = repairedCritique;
      }
      if (bestCritique.score >= QUALITY_SCORE_THRESHOLD) break;
    } catch (error) {
      console.warn("presentation quality repair failed:", error);
      break;
    }
  }

  console.info("presentation quality", {
    projectId: project.id,
    provider,
    beforeScore,
    afterScore: bestCritique.score,
    issueCounts: issueCountsRecord(bestCritique.issues),
    repairAttempts: attempts,
  });

  if (bestCritique.score < QUALITY_SCORE_THRESHOLD) {
    console.warn("presentation quality remains below threshold; saving best valid version", {
      projectId: project.id,
      provider,
      score: bestCritique.score,
      issueCounts: issueCountsRecord(bestCritique.issues),
    });
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
          thesis: cleanText(repair.thesis) || slide.thesis,
          bullets: Array.isArray(repair.bullets) ? repair.bullets.map(cleanText).filter(Boolean).slice(0, 5) : slide.bullets,
          blocks: Array.isArray(repair.blocks) ? repair.blocks : slide.blocks,
          visual: repair.visual ? { ...slide.visual, ...repair.visual } : slide.visual,
          speakerNotes: cleanText(repair.speakerNotes) || slide.speakerNotes,
          sourceRefs: Array.isArray(repair.sourceRefs) ? repair.sourceRefs : slide.sourceRefs,
        };
      })
    : presentation.slides;

  const speechScript = Array.isArray(response.speechScript)
    ? response.speechScript
    : presentation.speechScript.map((item) => {
        const slide = slides.find((candidate) => candidate.order === item.slideOrder);
        return slide ? { ...item, slideTitle: slide.title } : item;
      });

  return presentationSchema.parse({
    ...presentation,
    generatedText: cleanMultilineText(response.generatedText) || presentation.generatedText,
    outline: Array.isArray(response.outline) ? response.outline.map(cleanText).filter(Boolean) : slides.map((slide) => slide.title),
    speechScript,
    slides,
  });
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
    issues,
    passed: score >= QUALITY_SCORE_THRESHOLD && !issues.some((issue) => issue.severity === "blocker"),
  };
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
