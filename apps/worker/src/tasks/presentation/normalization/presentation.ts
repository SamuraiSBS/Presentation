import {
    designBriefSchema,
    hasMeasurableValue,
    mermaidDiagramSpecSchema,
    normalizeSourceRefs as normalizeSharedSourceRefs,
    presentationSchema,
    resolvePresentationTheme,
    sourceRefFromSource as sharedSourceRefFromSource,
    type DesignBrief,
    type Highlight,
    type KeyConcept,
    type MermaidDiagramSpec,
    type PresentationDocument,
    type Slide,
    type SlideBlock,
    type SlideDefinition,
    type SlideKind,
    type SlideLayout,
    type SlideNarrative,
    type SlideVisual,
    type Source
} from "@studydeck/shared";
import crypto from "node:crypto";

type ProjectInput = {
  id: string;
  title: string;
  prompt: string;
  scenario: string;
  level: string;
  mode: string;
  slideCount: number;
};

type AiGenerationMode = "openai" | "yandex" | "aitunnel" | "local";
type FallbackGenerationMode = "demo" | "demo-fallback";

type NarrationSection = {
  order: number;
  title: string;
  text: string;
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

import { CONTENT_LAYOUT_CYCLE, SLIDE_LAYOUTS } from "../constants.js";
import { isGenericNarrationSentence, isPromptEchoSentence, parseNarrationSections } from "../narration/processing.js";
import { balanceDeterministicVisualDirections, buildDesignBrief, buildFallbackNarrativeItem, buildResearchBrief, buildSceneTextMode, cleanNarrativeField, completeVisualPrompt, normalizeNarrativePlan, parseNarrativePlanRaw } from "../planning/builders.js";
import { assertPresentationQuality, assertRawGenerationQuality, firstCompleteScreenSentence, hasForbiddenTemplateText, isCompleteScreenSentence, looksLikeSentenceFragment, normalizeForQuality, pickCanonicalGeneratedText, shortenCompleteSentence } from "../quality/orchestration.js";
import { buildFallbackGeneratedText, clampNumber, cleanPresentationTitle, cleanText, normalizeGeneratedText, projectTopic, sanitizeScreenText, sanitizeSpeechText, shortenSentence, shortenWords } from "../utilities.js";

export function normalizePresentation(
  raw: unknown,
  project: ProjectInput,
  sources: Source[],
  generationMode: AiGenerationMode | FallbackGenerationMode,
  generatedText = "",
  narrativePlan: SlideNarrative[] = [],
  validate = true,
  designBrief?: DesignBrief,
): PresentationDocument {
  const input = raw && typeof raw === "object" ? (raw as Partial<PresentationDocument>) : {};
  const rawGeneratedText = pickCanonicalGeneratedText(input.generatedText, generatedText);
  assertRawGenerationQuality({ ...input, generatedText: rawGeneratedText }, project, generationMode);
  const publicSources = normalizeSources(sources, project);
  const normalizedGeneratedText = normalizeGeneratedText(
    rawGeneratedText || buildFallbackGeneratedText(project),
    project,
  );
  const narrationSections = parseNarrationSections(normalizedGeneratedText);
  const narrationByOrder = new Map(narrationSections.map((section) => [section.order, section]));
  const narrationOutline = Array.from({ length: project.slideCount }, (_, index) =>
    narrationByOrder.get(index + 1)?.title || "",
  ).filter(Boolean);
  const outline = narrationOutline.length === project.slideCount ? narrationOutline : normalizeOutline(input.outline);
  const rawSlides = Array.isArray(input.slides) ? input.slides : [];
  const normalizedDesignBrief = normalizeDesignBrief(designBrief || input.designBrief, project, publicSources, narrativePlan);
  const slides = rawSlides
    .slice(0, project.slideCount)
    .map((slide, index) => {
      const order = index + 1;
      return normalizeSlide(slide, order, publicSources, project, narrationByOrder.get(order));
    });

  while (slides.length < project.slideCount) {
    const order = slides.length + 1;
    slides.push(buildFallbackSlide(order, project, publicSources, narrationByOrder.get(order)));
  }

  repairRepeatedSlideTitles(slides, outline, project);
  diversifySlideLayouts(slides, normalizedDesignBrief);
  const normalizedNarrativePlan = normalizePresentationNarrativePlan(input.narrativePlan, narrativePlan, project, narrationByOrder, slides);
  const documentTitle = cleanPresentationTitle(input.title, project);

  const rawSpeechScript = Array.isArray(input.speechScript) ? input.speechScript : [];
  const rawSpeechScriptByOrder = new Map(rawSpeechScript
    .filter((item) => Number.isInteger(Number(item?.slideOrder)))
    .map((item) => [Number(item?.slideOrder), item]));
  const speechTitleCounts = countTitles(rawSpeechScript.map((item) => cleanText(item?.slideTitle)));
  const speechScript = slides.map((slide, index) => {
    const source = rawSpeechScriptByOrder.get(slide.order);
    const sourceTitle = cleanText(source?.slideTitle);
    const narrationSection = narrationByOrder.get(slide.order);

    return {
      slideOrder: slide.order,
      slideTitle: shouldReplaceTitle(sourceTitle, speechTitleCounts) ? slide.title : sourceTitle || narrationSection?.title || slide.title,
      text: normalizeSpeechScriptText(source?.text, slide, project, index, narrationSection?.text),
    };
  });

  const presentation = presentationSchema.parse({
    id: cleanText(input.id) || crypto.randomUUID(),
    title: documentTitle,
    scenario: cleanText(input.scenario) || project.scenario,
    level: cleanText(input.level) || project.level,
    slideCount: slides.length,
    generationMode,
    generatedText: normalizedGeneratedText,
    sources: publicSources,
    outline: slides.map((slide) => slide.title),
    narrativePlan: normalizedNarrativePlan,
    presentationTheme: resolvePresentationTheme({
      title: documentTitle,
      prompt: project.prompt,
      scenario: cleanText(input.scenario) || project.scenario,
      level: cleanText(input.level) || project.level,
      presentationTheme: input.presentationTheme,
      designBrief: normalizedDesignBrief,
    }),
    designBrief: normalizedDesignBrief,
    speechScript,
    slides,
  });

  if (validate) {
    assertPresentationQuality(presentation, project, generationMode);
  }
  return presentation;
}

export function normalizePresentationNarrativePlan(
  rawPlan: unknown,
  generatedPlan: SlideNarrative[],
  project: ProjectInput,
  narrationByOrder: Map<number, NarrationSection>,
  slides: Slide[],
) {
  const fromInput = normalizeNarrativePlan(rawPlan, project);
  const parsedRawPlan = parseNarrativePlanRaw(rawPlan);
  const inputHasPlan = Array.isArray(parsedRawPlan) && parsedRawPlan.length > 0;
  if (inputHasPlan) {
    return fromInput;
  }

  if (generatedPlan.length) {
    return normalizeNarrativePlan(generatedPlan, project);
  }

  return Array.from({ length: project.slideCount }, (_, index) => {
    const order = index + 1;
    const section = narrationByOrder.get(order);
    const slide = slides[index];
    const fallback = buildFallbackNarrativeItem(project, order, section?.title || slide?.title);
    return {
      ...fallback,
      slideTitle: cleanNarrativeField(section?.title || slide?.title, "title") || fallback.slideTitle,
      keyMessage: cleanNarrativeField(slide?.thesis || firstSentence(section?.text), "message") || fallback.keyMessage,
      transitionToNext: order === project.slideCount ? "" : fallback.transitionToNext,
    };
  });
}

export function normalizeDesignBrief(raw: unknown, project: ProjectInput, sources: Source[], narrativePlan: SlideNarrative[]) {
  const parsed = designBriefSchema.safeParse(raw);
  if (parsed.success) {
    return ensureDesignBriefDirections(parsed.data, project, narrativePlan, sources.some((source) => Boolean(source.excerpt || source.url)));
  }
  return buildDesignBrief(project, buildResearchBrief(project, sources), narrativePlan);
}

export function ensureDesignBriefDirections(
  brief: DesignBrief,
  project: ProjectInput,
  narrativePlan: SlideNarrative[],
  sourceGrounded = false,
) {
  let normalized = brief;
  if (brief.slideDirections.length !== project.slideCount) {
    const fallback = buildDesignBrief(project, {
      topic: projectTopic(project),
      angle: cleanText(project.prompt),
      facts: [],
      warnings: [],
      vocabulary: [],
    }, narrativePlan);
    const byOrder = new Map(brief.slideDirections.map((direction) => [direction.slideOrder, direction]));
    normalized = designBriefSchema.parse({
      ...brief,
      slideDirections: fallback.slideDirections.map((direction) => byOrder.get(direction.slideOrder) || direction),
    });
  }

  const slideDirections = normalized.slideDirections.map((direction) => {
    const plan = narrativePlan[direction.slideOrder - 1] || buildFallbackNarrativeItem(project, direction.slideOrder);
    if (direction.slideOrder === project.slideCount || direction.visualRole === "summary") {
      return {
        ...direction,
        layoutIntent: "summary" as const,
        imageStrategy: "none" as const,
        visualPurpose: "text_only" as const,
        sceneTextMode: "takeaway" as const,
        visualPrompt: completeVisualPrompt(project, plan, "none", "summary", direction.visualPrompt),
      };
    }
    if (direction.imageStrategy === "generated_illustration") {
      return {
        ...direction,
        layoutIntent: direction.visualRole === "hero" ? "statement" as const : "cards" as const,
        imageStrategy: "none" as const,
        visualPurpose: "text_only" as const,
        sceneTextMode: direction.visualRole === "hero" ? "hero_phrase" as const : "talk_sentences" as const,
        visualPrompt: completeVisualPrompt(project, plan, "none", direction.visualRole === "hero" ? "statement" : "cards", direction.visualPrompt),
      };
    }
    if (direction.imageStrategy !== "real_photo") {
      return {
        ...direction,
        visualPurpose: direction.visualPurpose || (direction.layoutIntent === "timeline" ? "timeline" : direction.layoutIntent === "comparison" ? "comparison" : direction.layoutIntent === "metric" ? "metric" : direction.imageStrategy === "diagram" ? "diagram" : "text_only"),
        sceneTextMode: buildSceneTextMode(direction.slideOrder, project.slideCount, direction.visualRole, direction.layoutIntent, direction.imageStrategy),
        visualPrompt: completeVisualPrompt(project, plan, direction.imageStrategy, direction.layoutIntent, direction.visualPrompt),
      };
    }
    return {
      ...direction,
      visualPurpose: "photo" as const,
      sceneTextMode: "visual_labels" as const,
      visualPrompt: completeVisualPrompt(project, plan, "real_photo", direction.layoutIntent, direction.visualPrompt),
    };
  });

  const hasGroundedVisualContext = sourceGrounded
    || normalized.slideDirections.some((direction) => direction.imageStrategy !== "none")
    || /\b(?:[A-Z][A-Za-z]{2,}|\d{3,4})\b/.test(`${project.title} ${project.prompt}`);
  return designBriefSchema.parse({ ...normalized, slideDirections: balanceDeterministicVisualDirections(slideDirections, project, narrativePlan, hasGroundedVisualContext) });
}

export function normalizeSlide(rawSlide: unknown, order: number, sources: Source[], project: ProjectInput, narrationSection?: NarrationSection): Slide {
  const slide = rawSlide && typeof rawSlide === "object" ? (rawSlide as Partial<Slide>) : {};
  const sourceRefs = normalizeSharedSourceRefs(slide.sourceRefs, sources);
  const rawBlocks = Array.isArray(slide.blocks) ? slide.blocks.map(normalizeBlock).filter((block): block is SlideBlock => Boolean(block)) : [];
  const slideKind = normalizeSlideKind(slide.slideKind, order, project.slideCount);
  const title = shortenWords(sanitizeScreenText(slide.title) || narrationSection?.title || fallbackTitle(project, order), slideKind === "title" ? 12 : 8);
  const acceptedNarration = narrationSection?.text || "";
  // Once narration has been accepted, incomplete provider fields may only be
  // completed from that section. Raw blocks remain available as the provider
  // projection, but must not become a second donor when a field is blank.
  const narrationFallbackSource = acceptedNarration || slideText(rawBlocks);
  const thesis = normalizeThesis(slide.thesis, rawBlocks, project, order, slideKind, title, narrationFallbackSource);
  const fallbackSource = acceptedNarration || [thesis, slideText(rawBlocks)].filter(Boolean).join(" ");
  const bullets = ensureSlideSentenceDensity(
    normalizeBullets(slide.bullets, rawBlocks, project, order, slideKind, title, fallbackSource, acceptedNarration),
    thesis,
    project,
    order,
    slideKind,
    fallbackSource,
    acceptedNarration,
  );
  const definition = normalizeDefinition(slide.definition);
  const keyConcepts = normalizeKeyConcepts(slide.keyConcepts, title, bullets, slideKind);
  const highlights = normalizeHighlights(slide.highlights, thesis, bullets, slideKind);
  const visual = normalizeVisual(slide.visual, title, thesis, bullets, slideKind, project, order, acceptedNarration ? thesis : "");
  const blocks = normalizeSlideBlocks(rawBlocks, project, order, thesis, bullets, slideKind, acceptedNarration);

  return {
    id: cleanText(slide.id) || `slide-${order}`,
    order,
    title,
    slideKind,
    layout: normalizeLayout(slide.layout, order, project.slideCount, slideKind, {
      title,
      thesis,
      bullets,
      definition,
      visual,
      blocks,
      sourceRefs,
    }),
    thesis,
    bullets,
    definition,
    keyConcepts,
    visual,
    highlights,
    blocks,
    placeholders: [],
    speakerNotes: normalizeSpeakerNotes(slide.speakerNotes, { title, thesis, bullets, definition, visual }, project, order, narrationSection?.text),
    timingSeconds: clampNumber(Number(slide.timingSeconds || 55), 20, 240),
    sourceRefs,
  };
}

export function normalizeBlock(block: unknown): SlideBlock | null {
  if (typeof block === "string") {
    const content = sanitizeScreenText(block);
    return content ? { type: "callout", content } : null;
  }

  if (!block || typeof block !== "object") {
    return null;
  }

  const candidate = block as Partial<SlideBlock>;
  if (candidate.type === "bullets") {
    const items = Array.isArray(candidate.items) ? candidate.items.map(sanitizeScreenText).filter(Boolean).slice(0, 5) : [];
    return items.length ? { type: "bullets", items } : null;
  }

  if (candidate.type === "quote" || candidate.type === "callout") {
    const content = sanitizeScreenText(candidate.content);
    return content ? { type: candidate.type, content } : null;
  }

  return null;
}

export function normalizeSlideKind(value: unknown, order: number, slideCount: number): SlideKind {
  if (order === 1) return "title";
  if (order === slideCount) return "summary";
  if (value === "section" || value === "content") return value;
  if (slideCount >= 6 && (order === 2 || order === Math.ceil(slideCount / 2))) return "section";
  return "content";
}

export function normalizeThesis(value: unknown, blocks: SlideBlock[], project: ProjectInput, order: number, slideKind: SlideKind, title = "", fallbackSource = "") {
  if (slideKind === "section") return "";
  const fromValue = firstSentence(sanitizeScreenText(value));
  if (fromValue && !isDuplicateDisplayText(fromValue, title)) return shortenSentence(fromValue, slideKind === "title" ? 150 : 180);
  const fromBlocks = firstSentence(slideText(blocks));
  const fromNarration = firstCompleteScreenSentence(fallbackSource);
  // Prefer section narration to an arbitrary provider block. The latter is a
  // projection to audit, never a fallback source for accepted narration.
  const fallback = [fromNarration, fromBlocks].find((item) => item && !isDuplicateDisplayText(item, title)) || "";
  return shortenSentence(fallback || fallbackSlideText(project, order), slideKind === "title" ? 150 : 180);
}

export function normalizeBullets(value: unknown, blocks: SlideBlock[], project: ProjectInput, order: number, slideKind: SlideKind, title = "", fallbackSource = "", acceptedNarration = "") {
  const fromValue = Array.isArray(value) ? value.map(sanitizeScreenText).filter(Boolean) : [];
  const fromBlocks = blocks.flatMap((block) => (block.type === "bullets" ? block.items : splitIntoSentences("content" in block ? block.content : "")));
  const items = uniqueShortItems([...fromValue, ...fromBlocks])
    .filter((item) => !looksLikeSentenceFragment(item))
    .filter((item) => !isDuplicateDisplayText(item, title))
    .slice(0, 5);

  if (slideKind === "title" || slideKind === "section") {
    return items.slice(0, 3);
  }

  if (slideKind !== "summary" && items.length) {
    return items.slice(0, 5);
  }

  // Sparse accepted speech is a valid compact projection. Do not manufacture
  // bullets from project-level fallback templates merely to fill a layout.
  if (acceptedNarration.trim()) return items.slice(0, 3);

  const minimum = slideKind === "summary" ? 3 : 2;
  const fallback = buildFallbackBulletItems(project, order, fallbackSource);
  return ensureRange(items, fallback, minimum, 5);
}

export function ensureSlideSentenceDensity(items: string[], thesis: string, project: ProjectInput, order: number, slideKind: SlideKind, fallbackSource = "", acceptedNarration = "") {
  const existing = uniqueShortItems(items).filter((item) => !looksLikeSentenceFragment(item)).slice(0, slideKind === "summary" ? 5 : 3);
  const visibleSentenceCount = splitIntoSentences([thesis, ...existing].join(" ")).length;
  const minimum = slideKind === "summary" ? 3 : 2;

  if (visibleSentenceCount >= minimum) {
    return existing;
  }

  if (acceptedNarration.trim()) return existing;

  const fallback = buildFallbackBulletItems(project, order, fallbackSource).filter((item) => item.toLowerCase() !== thesis.toLowerCase());
  return uniqueShortItems([...existing, ...fallback]).slice(0, slideKind === "summary" ? 5 : 3);
}

export function normalizeDefinition(value: unknown): SlideDefinition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SlideDefinition>;
  const term = sanitizeScreenText(candidate.term);
  const text = sanitizeScreenText(candidate.text);
  return term && text ? { term: shortenSentence(term, 60), text: shortenSentence(text, 180) } : null;
}

export function normalizeKeyConcepts(_value: unknown, _title: string, _bullets: string[], _slideKind: SlideKind): KeyConcept[] {
  return [];
}

export function normalizeHighlights(_value: unknown, _thesis: string, _bullets: string[], _slideKind: SlideKind): Highlight[] {
  return [];
}

export function normalizeVisual(
  value: unknown,
  title: string,
  thesis: string,
  bullets: string[],
  slideKind: SlideKind,
  project: ProjectInput,
  order: number,
  acceptedFallbackDescription = "",
): SlideVisual {
  const candidate = value && typeof value === "object" ? (value as Partial<SlideVisual>) : {};
  const requestedType = normalizeVisualType(candidate.type);
  const description = shortenSentence(
    sanitizeScreenText(candidate.description) || acceptedFallbackDescription || imageConcept(project, order, title, thesis, bullets, slideKind),
    260,
  );
  const rows = Array.isArray(candidate.rows)
    ? candidate.rows
        .map((row) => ({
          label: shortenSentence(sanitizeScreenText(row?.label), 80),
          left: shortenSentence(sanitizeScreenText(row?.left), 160),
          right: shortenSentence(sanitizeScreenText(row?.right), 160),
        }))
        .filter((row) => row.label || row.left || row.right)
        .slice(0, 8)
    : [];
  const items = Array.isArray(candidate.items)
    ? candidate.items
        .map((item) => ({
          label: shortenSentence(sanitizeScreenText(item?.label), 100),
          text: shortenSentence(sanitizeScreenText(item?.text), 180),
        }))
        .filter((item) => item.label || item.text)
        .slice(0, 8)
    : [];
  const completeRows = rows.filter((row) => row.left && row.right);
  const type = usefulVisualType(requestedType, items, completeRows);
  const diagram = normalizeMermaidDiagram(candidate, type, title, thesis, items, completeRows);

  if (type === "none") {
    return { ...emptyVisual(), description, ...(diagram ? { diagram } : {}) };
  }

  return {
    type,
    title: normalizeVisualTitle(candidate.title, title),
    description,
    leftLabel: shortenSentence(sanitizeScreenText(candidate.leftLabel) || defaultLeftLabel(type), 80),
    rightLabel: shortenSentence(sanitizeScreenText(candidate.rightLabel) || defaultRightLabel(type), 80),
    items: type === "image" || type === "illustration" ? [] : items,
    rows: isRowVisual(type) ? completeRows : [],
    ...(diagram ? { diagram } : {}),
  };
}

export function normalizeMermaidDiagram(
  candidate: Partial<SlideVisual>,
  type: SlideVisual["type"],
  title: string,
  thesis: string,
  items: SlideVisual["items"],
  rows: SlideVisual["rows"],
): MermaidDiagramSpec | null {
  const existing = mermaidDiagramSpecSchema.safeParse(candidate.diagram);
  if (existing.success) return existing.data;
  if (!["process_diagram", "cause_effect_diagram", "timeline", "mind_map", "schema", "comparison_diagram"].includes(type)) return null;

  const generated = buildMermaidDiagram(type, title, thesis, items, rows);
  const parsed = generated ? mermaidDiagramSpecSchema.safeParse(generated) : null;
  return parsed?.success ? parsed.data : null;
}

export function buildMermaidDiagram(
  type: SlideVisual["type"],
  title: string,
  thesis: string,
  items: SlideVisual["items"],
  rows: SlideVisual["rows"],
): MermaidDiagramSpec | null {
  const fallback = [thesis, ...items.map((item) => [item.label, item.text].filter(Boolean).join(": "))].filter(Boolean).join("\n");
  if (type === "timeline" && items.length >= 2) {
    return {
      kind: "timeline",
      title,
      caption: thesis,
      fallback,
      safety: "safe",
      source: ["timeline", `    title ${safeMermaidText(title)}`, ...items.slice(0, 6).map((item) => `    ${safeMermaidText(item.label)} : ${safeMermaidText(item.text || item.label)}`)].join("\n"),
    };
  }

  if (type === "mind_map" && items.length >= 2) {
    return {
      kind: "mindmap",
      title,
      caption: thesis,
      fallback,
      safety: "safe",
      source: ["mindmap", `  root((${safeMermaidText(title)}))`, ...items.slice(0, 6).map((item) => `    ${safeMermaidText(item.label || item.text)}`)].join("\n"),
    };
  }

  if (type === "comparison_diagram" && rows.length >= 1) {
    return {
      kind: "flowchart",
      title,
      caption: thesis,
      fallback: rows.map((row) => [row.label, row.left, row.right].filter(Boolean).join(": ")).join("\n"),
      safety: "safe",
      source: [
        "flowchart LR",
        `    A[${safeMermaidText(title)}]`,
        ...rows.slice(0, 4).flatMap((row, index) => [
          `    A --> L${index}[${safeMermaidText(row.left || row.label)}]`,
          `    A --> R${index}[${safeMermaidText(row.right || row.label)}]`,
        ]),
      ].join("\n"),
    };
  }

  if (items.length < 2) return null;
  const arrow = type === "cause_effect_diagram" ? "-->|влияет|" : "-->";
  return {
    kind: "flowchart",
    title,
    caption: thesis,
    fallback,
    safety: "safe",
    source: [
      "flowchart LR",
      ...items.slice(0, 6).map((item, index) => `    N${index}[${safeMermaidText(item.label || item.text)}]`),
      ...items.slice(0, 5).map((_, index) => `    N${index} ${arrow} N${index + 1}`),
    ].join("\n"),
  };
}

export function safeMermaidText(value: string) {
  return sanitizeScreenText(value)
    .replace(/[<>{}[\]|"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Идея";
}

export function normalizeVisualType(value: unknown): SlideVisual["type"] {
  const allowed: SlideVisual["type"][] = [
    "process_diagram",
    "comparison_diagram",
    "cause_effect_diagram",
    "before_after_table",
    "pros_cons_table",
    "timeline",
    "mind_map",
    "illustration",
    "schema",
    "image",
    "none",
  ];
  if (allowed.includes(value as SlideVisual["type"])) return value as SlideVisual["type"];
  // Yandex occasionally returns the semantic role rather than one of the
  // shared-contract names. Keep only aliases whose meaning is unambiguous;
  // everything else is deliberately reduced to an empty visual.
  const alias = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  const aliases: Record<string, SlideVisual["type"]> = {
    diagram: "process_diagram",
    process: "process_diagram",
    flowchart: "process_diagram",
    comparison: "comparison_diagram",
    compare: "comparison_diagram",
    cause_effect: "cause_effect_diagram",
    cause_and_effect: "cause_effect_diagram",
    mindmap: "mind_map",
    table: "before_after_table",
    photo: "image",
    picture: "image",
  };
  if (alias && aliases[alias]) return aliases[alias];
  return "none";
}

export function emptyVisual(): SlideVisual {
  return { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] };
}

export function normalizeVisualTitle(value: unknown, slideTitle: string) {
  const title = sanitizeScreenText(value);
  if (!title || isGenericVisualTitle(title) || isDuplicateDisplayText(title, slideTitle)) return "";
  return shortenSentence(title, 100);
}

export function isGenericVisualTitle(title: string) {
  const key = normalizeTitleKey(title);
  return ["visual example", "визуальный пример", "иллюстрация", "image"].includes(key);
}

export function usefulVisualType(type: SlideVisual["type"], items: SlideVisual["items"], rows: SlideVisual["rows"]): SlideVisual["type"] {
  if (isRowVisual(type)) {
    return rows.length >= 1 ? type : "none";
  }

  if (["process_diagram", "timeline", "mind_map", "schema"].includes(type)) {
    return items.filter((item) => item.label || item.text).length >= 2 ? type : "none";
  }

  if (type === "illustration" || type === "image") return type;

  return type === "none" ? "none" : type;
}

export function isRowVisual(type: SlideVisual["type"]) {
  return ["comparison_diagram", "before_after_table", "pros_cons_table", "cause_effect_diagram"].includes(type);
}

export function normalizeSources(sources: Source[], project: ProjectInput): Source[] {
  const normalized = sources
    .map((source) => ({
      id: cleanText(source.id),
      label: cleanText(source.label) || "Материал",
      type: cleanText(source.type) || "SOURCE",
      size: source.size || 0,
      excerpt: cleanText(source.excerpt),
      objectKey: source.objectKey || undefined,
      url: source.url || undefined,
    }))
    .filter((source) => source.id);

  return normalized.length
    ? normalized
    : [{ id: "src-prompt", label: "Запрос пользователя", type: "PROMPT", size: 0, excerpt: project.prompt }];
}

export function sourceRefFromSource(inputSource: Source | undefined) {
  if (inputSource) return sharedSourceRefFromSource(inputSource);
  return {
    sourceId: "src-prompt",
    label: "Запрос пользователя",
    excerpt: "",
    page: null,
  };
}

export function buildFallbackSlide(order: number, project: ProjectInput, sources: Source[], narrationSection?: NarrationSection): Slide {
  const source = sources[(order - 1) % sources.length];
  const slideKind = normalizeSlideKind(undefined, order, project.slideCount);
  const title = narrationSection?.title || fallbackTitle(project, order);
  const acceptedNarration = narrationSection?.text || "";
  const thesis = normalizeThesis("", [], project, order, slideKind, title, acceptedNarration);
  const bullets = ensureSlideSentenceDensity(
    normalizeBullets([], [], project, order, slideKind, title, acceptedNarration, acceptedNarration),
    thesis,
    project,
    order,
    slideKind,
    acceptedNarration,
    acceptedNarration,
  );
  const definition = null;
  const visual = acceptedNarration
    ? { ...emptyVisual(), description: thesis }
    : fallbackVisual(order, title, thesis, bullets, slideKind, project);
  const blocks = buildFallbackBlocks(project, order, thesis, bullets, slideKind);
  return {
    id: `slide-${order}`,
    order,
    title,
    slideKind,
    layout: normalizeLayout(undefined, order, project.slideCount, slideKind, { title, thesis, bullets, definition, visual, blocks }),
    thesis,
    bullets,
    definition,
    keyConcepts: normalizeKeyConcepts([], title, bullets, slideKind),
    visual,
    highlights: normalizeHighlights([], thesis, bullets, slideKind),
    blocks,
    placeholders: [],
    speakerNotes: narrationSection?.text || buildFallbackSpeakerNotes(project, order),
    timingSeconds: order === 1 || order === project.slideCount ? 45 : 55,
    sourceRefs: [sourceRefFromSource(source)],
  };
}

export function buildFallbackBlocks(project: ProjectInput, order = 1, thesis = "", bullets: string[] = [], slideKind: SlideKind = "content"): SlideBlock[] {
  if (slideKind === "title" || slideKind === "section") {
    return [{ type: "callout", content: thesis || fallbackSlideText(project, order) }];
  }

  const layout = CONTENT_LAYOUT_CYCLE[(order - 2 + CONTENT_LAYOUT_CYCLE.length) % CONTENT_LAYOUT_CYCLE.length];
  if (layout === "quote") {
    return [{ type: "quote", content: thesis || fallbackSlideText(project, order) }];
  }

  if (["statement", "question-answer", "image-focus"].includes(layout)) {
    return [{ type: "callout", content: thesis || fallbackSlideText(project, order) }];
  }

  if (slideKind === "summary" || bullets.length >= 2) {
    return [{ type: "bullets", items: bullets.length ? bullets : buildFallbackBulletItems(project, order) }];
  }

  return [{ type: "callout", content: thesis || fallbackSlideText(project, order) }];
}

export function fallbackVisual(order: number, title: string, thesis: string, bullets: string[], slideKind: SlideKind, project: ProjectInput): SlideVisual {
  const layout = CONTENT_LAYOUT_CYCLE[(order - 2 + CONTENT_LAYOUT_CYCLE.length) % CONTENT_LAYOUT_CYCLE.length];
  const items = bullets.slice(0, 4).map((text) => ({
    label: shortenSentence(text, 100),
    text: shortenSentence(text, 180),
  }));
  const description = imageConcept(project, order, title, thesis, bullets, slideKind);

  if (slideKind === "title" || slideKind === "section") {
    return { ...emptyVisual(), type: "image", title: "", description };
  }

  if (layout === "process" && items.length >= 2) {
    return { ...emptyVisual(), type: "process_diagram", title: "", description, items };
  }

  if (layout === "timeline" && items.length >= 2) {
    return { ...emptyVisual(), type: "timeline", title: "", description, items };
  }

  return { ...emptyVisual(), type: "image", title: "", description };
}

export function imageConcept(project: ProjectInput, order: number, title: string, thesis: string, bullets: string[], slideKind: SlideKind) {
  const topic = projectTopic(project);
  const focus = cleanText(title || fallbackTitle(project, order));
  const detail = cleanText(thesis || bullets[0] || project.prompt);
  const role = slideKind === "summary" ? "summary educational image" : slideKind === "title" ? "opening educational image" : "educational image";
  return shortenSentence(`${role}: ${topic}; ${focus}; ${detail}`, 220);
}

export function fallbackTitle(project: ProjectInput, order: number) {
  const topic = projectTopic(project);
  const titles = [
    topic,
    "Исторический контекст",
    "Причины напряженности",
    "Главные участники",
    "Ключевой поворот",
    "Как искали решение",
    "Последствия кризиса",
    "Уроки для политики",
    "Итоговый вывод",
    "Почему это важно",
  ];
  return shortenWords(titles[order - 1] || `${order}. ${topic}`, 12);
}

export function normalizeSlideBlocks(
  blocks: SlideBlock[],
  project: ProjectInput,
  order: number,
  thesis: string,
  bullets: string[],
  slideKind: SlideKind,
  acceptedNarration = "",
): SlideBlock[] {
  if (blocks.length) {
    const normalized = blocks.slice(0, 3);
    const text = slideText(normalized);
    if (splitIntoSentences([thesis, text].filter(Boolean).join(" ")).length >= 2) {
      return normalized;
    }
    if (acceptedNarration.trim()) return normalized;
    const fallbackItems = ensureSlideSentenceDensity([], thesis, project, order, slideKind).slice(0, 2);
    return [...normalized, { type: "bullets" as const, items: fallbackItems }].slice(0, 3);
  }
  return buildFallbackBlocks(project, order, thesis, bullets, slideKind);
}

export function normalizeSpeakerNotes(
  value: unknown,
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual">,
  project: ProjectInput,
  order: number,
  narrationText = "",
) {
  const narration = sanitizeSpeechText(narrationText);
  if (isCompleteNarration(narration)) {
    return limitSentences(narration, 7);
  }

  const text = sanitizeSpeechText(value);
  if (isCompleteNarration(text)) {
    return limitSentences(text, 7);
  }

  return buildSlideNarration(slide, project, order);
}

export function normalizeSpeechScriptText(value: unknown, slide: Slide, project: ProjectInput, index: number, narrationText = "") {
  const narration = sanitizeSpeechText(narrationText);
  if (isCompleteNarration(narration)) {
    return limitSentences(narration, 7);
  }

  const text = sanitizeSpeechText(value);
  if (isCompleteNarration(text)) {
    return limitSentences(text, 7);
  }

  return normalizeSpeakerNotes(slide.speakerNotes, slide, project, index + 1);
}

export function buildSlideNarration(slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual">, project: ProjectInput, order: number) {
  return buildNarrationFromContent(
    cleanText(slide.title) || fallbackTitle(project, order),
    cleanText(slide.thesis) || fallbackSlideText(project, order),
    [
      ...slide.bullets.map(cleanText).filter(Boolean),
      slide.definition?.text || "",
      visualNarrationText(slide.visual),
    ],
    project,
    order,
  );
}

export function buildNarrationFromContent(titleInput: string, thesisInput: string, pointInputs: string[], project: ProjectInput, order: number) {
  const title = cleanText(titleInput) || fallbackTitle(project, order);
  const thesis = cleanText(thesisInput) || fallbackSlideText(project, order);
  const candidates = [thesis, ...pointInputs]
    .flatMap((value) => {
      const clean = cleanText(value);
      const sentences = speechSentences(clean);
      return sentences.length > 1 ? sentences : [completeNarrationSentence(clean)];
    })
    .filter((item) => !isDuplicateDisplayText(item, title));
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const sentence of candidates.flatMap((candidate) => speechSentences(sanitizeSpeechText(candidate)))) {
    const clean = cleanText(sentence);
    const key = normalizeForQuality(clean);
    if (!key || seen.has(key)) continue;
    if (clean.split(/\s+/).filter(Boolean).length < 4) continue;
    if (looksLikeSentenceFragment(clean) || isGenericNarrationSentence(clean) || isPromptEchoSentence(clean, project)) continue;
    selected.push(clean);
    seen.add(key);
    if (selected.length >= 7) break;
  }

  if (selected.length < 3) {
    for (const sentence of candidates.flatMap((candidate) => speechSentences(cleanText(candidate)))) {
      const clean = completeNarrationSentence(sentence);
      const key = normalizeForQuality(clean);
      if (!key || seen.has(key) || hasForbiddenTemplateText(clean)) continue;
      if (clean.split(/\s+/).filter(Boolean).length < 4) continue;
      selected.push(clean);
      seen.add(key);
      if (selected.length >= 3) break;
    }
  }

  return selected.length ? selected.join(" ") : completeNarrationSentence(title);
}

export function completeNarrationSentence(value: string) {
  const text = cleanText(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function visualNarrationText(visual: SlideVisual) {
  if (!visual || visual.type === "none") return "";
  const item = visual.items.find((entry) => entry.label || entry.text);
  const row = visual.rows.find((entry) => entry.label || entry.left || entry.right);
  return cleanText(item?.text || item?.label || row?.left || row?.right || visual.description || visual.title);
}

export function isCompleteNarration(text: string) {
  const count = sentenceCount(text);
  if (count < 2 || count > 7) return false;
  if (text.length < 80) return false;
  return !hasForbiddenTemplateText(text);
}

export function sentenceCount(text: string) {
  return speechSentences(text).length;
}

export function limitSentences(text: string, max: number) {
  const sentences = speechSentences(text);
  return sentences.slice(0, max).join(" ");
}

export function speechSentences(text: string) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

export function sentenceFragment(value: string) {
  const text = cleanText(value).replace(/[.!?]+$/g, "");
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : "";
}

export function sentenceEdgeKey(value: string) {
  return normalizeForQuality(value).split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
}

export function buildFallbackBulletItems(project: ProjectInput, order: number, sourceText = "") {
  const topic = projectTopic(project);
  const focus = order > 1 ? fallbackTitle(project, order) : topic;
  const sourceItems = uniqueShortItems(
    splitIntoSentences(sourceText)
      .filter(isCompleteScreenSentence)
      .map((item) => shortenCompleteSentence(item, 18)),
  );
  if (sourceItems.length >= 3) {
    return sourceItems.slice(0, 5);
  }
  const base = [
    ...sourceItems,
    ...fallbackTopicBulletItems(project, order, focus),
  ];
  return uniqueShortItems(base).slice(0, 5);
}

export function fallbackTopicBulletItems(project: ProjectInput, order: number, focus: string) {
  const topic = projectTopic(project);
  const historical = isHistoricalTopic(topic);
  const sets = historical
    ? [
        [`${topic} возник на фоне международной напряженности.`, "Решения лидеров быстро повышали цену ошибки.", "Развязка зависела от переговоров и контроля риска."],
        ["Контекст показывает, почему локальный конфликт стал мировым кризисом.", "Военные и политические решения усиливали взаимное недоверие.", "Общественная тревога росла вместе с угрозой прямого столкновения."],
        ["Причины кризиса связаны с безопасностью, влиянием и балансом сил.", "Каждая сторона стремилась защитить свои стратегические интересы.", "Компромисс стал возможен только после признания взаимных рисков."],
        ["Главные участники действовали под давлением времени и союзников.", "Ошибочная оценка намерений могла привести к резкой эскалации.", "Переговоры стали способом остановить опасную цепочку решений."],
        ["Ключевой поворот наступил, когда риск войны стал слишком очевидным.", "Секретная и публичная дипломатия работали одновременно.", "Именно сочетание давления и уступок помогло снизить напряжение."],
        ["Решение кризиса строилось на взаимных шагах назад.", "Компромисс позволил сторонам сохранить лицо и избежать столкновения.", "После кризиса контроль над ядерными рисками стал важнее."],
        ["Последствия кризиса изменили подход к прямой связи между лидерами.", "Мир увидел, насколько опасной может быть логика сдерживания.", "Политические решения стали осторожнее из-за памяти о риске войны."],
        ["Урок кризиса в том, что сила без коммуникации повышает опасность.", "Дипломатия работает лучше, когда признает страхи обеих сторон.", "История показывает цену решений, принятых в условиях давления."],
        ["Итоговый вывод связан с ответственностью политических лидеров.", "Кризис показал пределы военного давления.", "Главным результатом стало понимание необходимости контроля эскалации."],
        [`${topic} важен как пример опасного столкновения сверхдержав.`, "Его значение сохраняется в разговорах о безопасности.", "История кризиса помогает понять современную международную политику."],
      ]
    : [
        [`${topic} показывает центральный вопрос выступления.`, `${focus} дает опору для разбора темы.`, "Итог называет результат, который важно запомнить."],
        ["Контекст задает исходную ситуацию.", "Ключевые причины показывают развитие проблемы.", "Последствия показывают практическое значение результата."],
        [`${topic} держится на причинах, примерах и результате.`, "Каждый пункт отделяет главное от второстепенного.", "Финал фиксирует практический вывод для аудитории."],
      ];
  return sets[(order - 1) % sets.length].map((item) => shortenCompleteSentence(item, 16));
}

export function isHistoricalTopic(value: string) {
  return /кризис|войн|конфликт|революц|истори|импер|ссср|сша|кариб|холодн|политик|дипломат|международ/iu.test(value);
}

export function ensureRange(items: string[], fallback: string[], min: number, max: number) {
  const next = uniqueShortItems([...items, ...fallback]).slice(0, max);
  return next.length >= min ? next : fallback.slice(0, max);
}

export function uniqueShortItems(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const clean = shortenSentence(sanitizeScreenText(item).replace(/^[-*]\s*/, ""), 130);
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

export function splitIntoSentences(value: unknown) {
  return cleanText(value)
    .split(/(?<=[.!?])\s+|[;\n]+/)
    .map(sanitizeScreenText)
    .filter(Boolean);
}

export function firstSentence(value: unknown) {
  return splitIntoSentences(value)[0] || "";
}

export function lastSentence(value: unknown) {
  const sentences = splitIntoSentences(value);
  return sentences[sentences.length - 1] || "";
}

export function wordCount(value: unknown) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

export function defaultLeftLabel(type: SlideVisual["type"]) {
  if (type === "before_after_table") return "До";
  if (type === "pros_cons_table") return "Плюсы";
  if (type === "comparison_diagram") return "Первое";
  if (type === "cause_effect_diagram") return "Причина";
  return "";
}

export function defaultRightLabel(type: SlideVisual["type"]) {
  if (type === "before_after_table") return "После";
  if (type === "pros_cons_table") return "Минусы";
  if (type === "comparison_diagram") return "Второе";
  if (type === "cause_effect_diagram") return "Следствие";
  return "";
}

export function slideText(blocks: SlideBlock[]) {
  return sanitizeScreenText(
    blocks
      .flatMap((block) => (block.type === "bullets" ? block.items : [block.content]))
      .filter(Boolean)
      .slice(0, 5)
      .join(" "),
  );
}

export function normalizeOutline(value: unknown) {
  return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
}

export function repairRepeatedSlideTitles(slides: Slide[], outline: string[], project: ProjectInput) {
  const titleCounts = countTitles(slides.map((slide) => slide.title));
  const outlineCounts = countTitles(outline);

  slides.forEach((slide, index) => {
    if (!shouldReplaceTitle(slide.title, titleCounts)) {
      return;
    }

    const outlineTitle = cleanText(outline[index]);
    slide.title = shouldReplaceTitle(outlineTitle, outlineCounts) ? fallbackTitle(project, slide.order) : outlineTitle;
  });
}

export function countTitles(titles: string[]) {
  return titles.reduce<Map<string, number>>((counts, title) => {
    const key = normalizeTitleKey(title);
    if (key) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, new Map());
}

export function shouldReplaceTitle(title: string, titleCounts: Map<string, number>) {
  const key = normalizeTitleKey(title);
  return !key || isGenericSlideTitle(key) || (titleCounts.get(key) || 0) > 1;
}

export function normalizeTitleKey(title: string) {
  return cleanText(title).toLowerCase();
}

export function isDuplicateDisplayText(value: string, reference: string) {
  const left = normalizeComparableText(value);
  const right = normalizeComparableText(reference);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 18 && longer.includes(shorter);
}

export function normalizeComparableText(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGenericSlideTitle(titleKey: string) {
  return [
    "введение",
    "intro",
    "introduction",
    "слайд",
    "slide",
    "титульный слайд",
  ].includes(titleKey);
}

export function fallbackSlideText(project: ProjectInput, order: number) {
  const topic = projectTopic(project);
  const texts = fallbackTopicBulletItems(project, order, fallbackTitle(project, order));
  return shortenSentence(texts[0] || `${topic}: суть лучше объяснить коротко и по существу.`, 230);
}

export function buildFallbackSpeakerNotes(project: ProjectInput, order: number) {
  return buildSlideNarration(
    {
      title: fallbackTitle(project, order),
      thesis: fallbackSlideText(project, order),
      bullets: buildFallbackBulletItems(project, order).slice(0, 3),
      definition: null,
      visual: emptyVisual(),
    },
    project,
    order,
  );
}

export function normalizeLayout(
  layout: unknown,
  order: number,
  slideCount: number,
  slideKind: SlideKind,
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>,
): Slide["layout"] {
  if (order === 1 || slideKind === "title" || slideKind === "section") return "hero";
  if (order === slideCount || slideKind === "summary") return "summary";

  const requestedLayout = layout === "two-column" ? "comparison" : layout === "case-study" ? "process" : layout;
  const requested = SLIDE_LAYOUTS.includes(requestedLayout as SlideLayout) ? (requestedLayout as SlideLayout) : undefined;
  if (requested && requested !== "hero" && requested !== "summary") {
    if (layoutHasEnoughContent(requested, slide)) return requested;
    const inferred = inferContentLayout(slide, order);
    return inferred !== requested && layoutHasEnoughContent(inferred, slide) ? inferred : fallbackForSparseLayout(requested, slide);
  }

  return inferContentLayout(slide, order);
}

export function inferContentLayout(
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>,
  order: number,
): Slide["layout"] {
  if (slide.visual.image?.url) return "image-focus";
  if (slide.blocks.some((block) => block.type === "quote")) return "quote";
  if (slide.visual.type === "timeline" && layoutHasEnoughContent("timeline", slide)) return "timeline";
  if (slide.visual.type === "process_diagram" && layoutHasEnoughContent("process", slide)) return "process";
  if (slide.visual.type === "cause_effect_diagram" && layoutHasEnoughContent("process", slide)) return "process";
  if (hasMeasurableText(slide)) return "metrics";

  return CONTENT_LAYOUT_CYCLE[(order - 2 + CONTENT_LAYOUT_CYCLE.length) % CONTENT_LAYOUT_CYCLE.length];
}

export function diversifySlideLayouts(slides: Slide[], designBrief?: DesignBrief) {
  const contentSlides = slides.filter((slide) => slide.slideKind === "content");
  const contentCount = contentSlides.length;
  if (!contentCount) return;
  const directions = new Map((designBrief?.slideDirections || []).map((direction) => [direction.slideOrder, direction]));

  let previous: SlideLayout[] = [];
  contentSlides.forEach((slide, index) => {
    const directed = layoutFromDesignDirection(directions.get(slide.order), slide);
    const semantic = inferContentLayout(slide, slide.order);
    let next = directed || semantic;

    if (previous.length >= 2 && previous.at(-1) === next && previous.at(-2) === next) {
      next = nextDiverseLayout(index, previous, slide);
    }

    slide.layout = next;
    previous = [...previous.slice(-1), next];
  });
}

export function layoutFromDesignDirection(
  direction: DesignBrief["slideDirections"][number] | undefined,
  slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>,
): SlideLayout | null {
  if (!direction) return null;
  const candidates: SlideLayout[] =
    direction.layoutIntent === "full_bleed_image" || direction.layoutIntent === "split_image_text" ? ["image-focus", "statement"] :
    direction.layoutIntent === "statement" ? ["statement", "quote"] :
    direction.layoutIntent === "cards" ? ["statement", "quote"] :
    direction.layoutIntent === "timeline" ? ["timeline", "process"] :
    direction.layoutIntent === "diagram" ? ["process", "statement"] :
    direction.layoutIntent === "comparison" ? ["comparison", "statement"] :
    direction.layoutIntent === "evidence_board" ? ["metrics", "statement"] :
    direction.layoutIntent === "quote_spread" ? ["quote", "statement"] :
    direction.layoutIntent === "metric" ? ["metrics", "statement"] :
    direction.layoutIntent === "summary" ? ["summary"] :
    [];

  return candidates.find((candidate) => candidate !== "summary" && layoutHasEnoughContent(candidate, slide)) || null;
}

export function nextDiverseLayout(index: number, previous: SlideLayout[], slide: Slide): SlideLayout {
  for (let offset = 0; offset < CONTENT_LAYOUT_CYCLE.length; offset += 1) {
    const candidate = CONTENT_LAYOUT_CYCLE[(index + offset) % CONTENT_LAYOUT_CYCLE.length];
    if (candidate !== previous.at(-1) && candidate !== previous.at(-2) && layoutHasEnoughContent(candidate, slide)) {
      return candidate;
    }
  }

  return previous.at(-1) === "statement" ? "quote" : "statement";
}

export function layoutHasEnoughContent(layout: SlideLayout, slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>) {
  if (layout === "definition") return Boolean(slide.definition || slide.thesis);
  if (layout === "quote") return slide.blocks.some((block) => block.type === "quote") || Boolean(slide.thesis);
  if (layout === "two-column") return false;
  if (layout === "comparison") {
    return slide.visual.rows.filter((row) => cleanText(row.left) && cleanText(row.right)).length >= 2
      && Boolean(cleanText(slide.visual.leftLabel) && cleanText(slide.visual.rightLabel));
  }
  if (layout === "process") {
    return slide.visual.items.filter((item) => cleanText(item.label) && cleanText(item.text)).length >= 3;
  }
  if (layout === "timeline") {
    return slide.visual.items.filter((item) => cleanText(item.label) && cleanText(item.text)).length >= 3;
  }
  if (layout === "question-answer") return Boolean(cleanText(slide.thesis) && slide.bullets.filter(cleanText).length >= 2);
  if (layout === "myth-fact") {
    return slide.visual.items.filter((item) => cleanText(item.label) || cleanText(item.text)).length >= 2
      && slide.bullets.filter(cleanText).length >= 1;
  }
  if (layout === "metrics") return hasMeasurableText(slide);
  if (layout === "evidence") return Boolean(slide.thesis && slide.bullets.length >= 2);
  if (layout === "problem-solution") return slide.visual.items.length >= 3 || slide.bullets.length >= 3;
  if (layout === "explain-example") return Boolean(slide.definition || slide.thesis) && slide.bullets.length >= 1;
  if (layout === "image-focus") return Boolean(slide.visual.image?.url);
  return true;
}

export function fallbackForSparseLayout(
  layout: SlideLayout,
  _slide: Pick<Slide, "title" | "thesis" | "bullets" | "definition" | "visual" | "blocks"> & Partial<Pick<Slide, "sourceRefs">>,
): SlideLayout {
  if (layout === "question-answer" || layout === "myth-fact" || layout === "comparison" || layout === "problem-solution") {
    return "statement";
  }
  return "statement";
}

export function hasMeasurableText(slide: Pick<Slide, "title" | "thesis" | "bullets" | "blocks">) {
  const text = [
    slide.title,
    slide.thesis,
    ...slide.bullets,
    ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
  ].join(" ");

  return hasMeasurableValue(text);
}
