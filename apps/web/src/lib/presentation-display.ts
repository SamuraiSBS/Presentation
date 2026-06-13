import type { Highlight, KeyConcept, PresentationDocument, SlideBlock, SlideKind, SlideVisual } from "@studydeck/shared";

type ProjectWithPresentation = {
  presentation?: { document?: PresentationDocument | null } | null;
};

export function sanitizeProjectForDisplay<T extends ProjectWithPresentation>(project: T): T {
  const document = project.presentation?.document;
  if (!document) return project;

  return {
    ...project,
    presentation: {
      ...project.presentation,
      document: sanitizePresentationForDisplay(document),
    },
  };
}

export function sanitizePresentationForDisplay(document: PresentationDocument): PresentationDocument {
  const outline = Array.isArray(document.outline) ? document.outline.map(cleanText).filter(Boolean) : [];
  const outlineTitleCounts = countTitles(outline);
  const slides = document.slides.map((slide, index) => {
    const blocks = normalizeBlocksForDisplay(slide.blocks, slide.title);
    const title = repairSlideTitle(slide.title, index, outline, outlineTitleCounts, blocks);
    const slideKind = normalizeSlideKind(slide.slideKind, index, document.slides.length);
    const thesis = normalizeThesis(slide.thesis, blocks, title);
    const bullets = normalizeBullets(slide.bullets, blocks, title, slideKind);
    const definition = normalizeDefinition(slide.definition);
    const keyConcepts = normalizeKeyConcepts(slide.keyConcepts, title, bullets, slideKind);
    const highlights = normalizeHighlights(slide.highlights, thesis, bullets, slideKind);
    const visual = normalizeVisual(slide.visual, title, bullets, slideKind);
    const speakerNotes = sanitizeDisplayText(slide.speakerNotes) || fallbackSpeech(title);

    return {
      ...slide,
      title,
      slideKind,
      thesis,
      bullets,
      definition,
      keyConcepts,
      visual,
      highlights,
      blocks,
      speakerNotes,
      sourceRefs: [],
      timingSeconds: slide.timingSeconds || (index === 0 ? 45 : 55),
    };
  });

  return {
    ...document,
    sources: [],
    slides,
    speechScript: slides.map((slide, index) => {
      const existing = document.speechScript.find((item) => item.slideOrder === slide.order) || document.speechScript[index];
      const text = sanitizeDisplayText(existing?.text);
      const slideNotes = sanitizeDisplayText(slide.speakerNotes);
      const fallbackText = isGenericSpeechText(slideNotes) ? narrationFromSlide(slide) : slideNotes;
      return {
        slideOrder: slide.order,
        slideTitle: shouldReplaceTitle(existing?.slideTitle) ? slide.title : sanitizeDisplayText(existing?.slideTitle || slide.title) || slide.title,
        text: shouldReplaceSpeechText(text, fallbackText) ? fallbackText : text || fallbackText,
      };
    }),
  };
}

export function slideBodyTextForDisplay(blocks: SlideBlock[], fallback = "") {
  return sentencePreview(
    sanitizeDisplayText(
      blocks
        .flatMap((block) => (block.type === "bullets" ? block.items : "content" in block ? [block.content] : []))
        .filter(Boolean)
        .slice(0, 3)
        .join(" "),
    ) || fallback,
  );
}

export function slideStructuredTextForDisplay(slide: PresentationDocument["slides"][number]) {
  return sanitizeDisplayText([slide.thesis, ...slide.bullets].filter(Boolean).join(" ")) || slideBodyTextForDisplay(slide.blocks, slide.title);
}

function normalizeSlideKind(value: unknown, index: number, total: number): SlideKind {
  if (index === 0) return "title";
  if (index === total - 1) return "summary";
  return value === "section" || value === "content" ? value : "content";
}

function normalizeThesis(value: unknown, blocks: SlideBlock[], fallback: string) {
  return sentencePreview(sanitizeDisplayText(value) || slideBodyTextForDisplay(blocks, fallback));
}

function normalizeBullets(value: unknown, blocks: SlideBlock[], fallback: string, slideKind: SlideKind) {
  const items = Array.isArray(value) ? value.map(sanitizeDisplayText).filter(Boolean) : [];
  const blockItems = blocks.flatMap((block) => (block.type === "bullets" ? block.items : splitSentences("content" in block ? block.content : "")));
  const merged = uniqueShortItems([...items, ...blockItems]);
  if (slideKind === "title" || slideKind === "section") return merged.slice(0, 3);
  return (merged.length ? merged : splitSentences(fallback)).slice(0, 5);
}

function normalizeDefinition(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { term?: unknown; text?: unknown };
  const term = sanitizeDisplayText(candidate.term);
  const text = sanitizeDisplayText(candidate.text);
  return term && text ? { term, text } : null;
}

function normalizeKeyConcepts(value: unknown, title: string, bullets: string[], slideKind: SlideKind): KeyConcept[] {
  const items = Array.isArray(value)
    ? value
        .map((item) => {
          if (typeof item === "string") return { label: sanitizeDisplayText(item), icon: "dot" };
          if (!item || typeof item !== "object") return null;
          const candidate = item as { label?: unknown; icon?: unknown };
          const label = sanitizeDisplayText(candidate.label);
          return label ? { label, icon: sanitizeIcon(candidate.icon) } : null;
        })
        .filter((item): item is KeyConcept => Boolean(item))
    : [];
  if (items.length || slideKind === "title" || slideKind === "section") return dedupeConcepts(items).slice(0, 5);
  return uniqueShortItems([title, ...bullets]).slice(0, 4).map((label, index) => ({
    label,
    icon: ["idea", "check", "map", "process"][index] || "dot",
  }));
}

function normalizeHighlights(value: unknown, thesis: string, bullets: string[], slideKind: SlideKind): Highlight[] {
  const items = Array.isArray(value)
    ? value
        .map((item) => {
          if (typeof item === "string") return { text: sanitizeDisplayText(item), tone: "accent" as const };
          if (!item || typeof item !== "object") return null;
          const candidate = item as { text?: unknown; tone?: unknown };
          const text = sanitizeDisplayText(candidate.text);
          const tone = candidate.tone === "success" || candidate.tone === "warning" || candidate.tone === "neutral" ? candidate.tone : "accent";
          return text ? { text, tone } : null;
        })
        .filter((item): item is Highlight => Boolean(item))
    : [];
  if (items.length || slideKind === "title" || slideKind === "section") return items.slice(0, 6);
  return uniqueShortItems([thesis, ...bullets].join(" ").split(/\s+/).filter((word) => word.length >= 5))
    .slice(0, 4)
    .map((text, index) => ({ text, tone: index === 1 ? "success" : "accent" }));
}

function normalizeVisual(value: unknown, title: string, bullets: string[], slideKind: SlideKind): SlideVisual {
  const empty: SlideVisual = { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] };
  if (slideKind === "title") return empty;
  const candidate = value && typeof value === "object" ? (value as Partial<SlideVisual>) : {};
  const type = normalizeVisualType(candidate.type, title, bullets, slideKind);
  const items = Array.isArray(candidate.items)
    ? candidate.items.map((item) => ({ label: sanitizeDisplayText(item?.label), text: sanitizeDisplayText(item?.text) })).filter((item) => item.label || item.text).slice(0, 8)
    : bullets.slice(0, 5).map((label) => ({ label, text: "" }));
  const rows = Array.isArray(candidate.rows)
    ? candidate.rows.map((row) => ({ label: sanitizeDisplayText(row?.label), left: sanitizeDisplayText(row?.left), right: sanitizeDisplayText(row?.right) })).filter((row) => row.label || row.left || row.right).slice(0, 8)
    : [];
  return {
    type,
    title: sanitizeDisplayText(candidate.title) || visualTitle(type),
    description: sanitizeDisplayText(candidate.description),
    leftLabel: sanitizeDisplayText(candidate.leftLabel),
    rightLabel: sanitizeDisplayText(candidate.rightLabel),
    items,
    rows: rows.length ? rows : fallbackRows(type, bullets),
  };
}

export function sanitizeDisplayText(value: unknown) {
  const banned = [
    "источник",
    "источники",
    "source",
    "sourcerefs",
    "проверьте",
    "проверить",
    "добавьте",
    "добавить",
    "добавлю несколько деталей",
    "ключевой вывод нужно связать",
    "тезис нужно объяснить",
    "основная мысль слайда",
  ];
  const parts = cleanText(value)
    .replace(/^#+\s*/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts
    .filter((part) => {
      const lower = part.toLowerCase();
      return !banned.some((phrase) => lower.includes(phrase));
    })
    .join(" ")
    .trim();
}

function normalizeBlocksForDisplay(blocks: SlideBlock[], fallback: string): SlideBlock[] {
  const normalized = Array.isArray(blocks)
    ? blocks
        .map((block) => {
          if (block.type === "bullets") {
            const items = block.items.map(sanitizeDisplayText).filter(Boolean).slice(0, 5);
            return items.length ? { type: "bullets" as const, items } : null;
          }
          const content = sanitizeDisplayText(block.content);
          return content ? { type: block.type, content } : null;
        })
        .filter((block): block is SlideBlock => Boolean(block))
    : [];

  return normalized.length
    ? normalized
    : [{ type: "callout", content: slideBodyTextForDisplay([], `Коротко раскрывается тема: ${fallback}.`) }];
}

function repairSlideTitle(title: string, index: number, outline: string[], outlineTitleCounts: Map<string, number>, blocks: SlideBlock[]) {
  const cleanTitle = sanitizeDisplayText(title);
  if (!shouldReplaceTitle(cleanTitle)) {
    return cleanTitle;
  }

  const outlineTitle = sanitizeDisplayText(outline[index]);
  if (!shouldReplaceTitle(outlineTitle) && (outlineTitleCounts.get(normalizeTitleKey(outlineTitle)) || 0) === 1) {
    return outlineTitle;
  }

  return titleFromBlocks(blocks) || `Слайд ${index + 1}`;
}

function titleFromBlocks(blocks: SlideBlock[]) {
  const text = slideBodyTextForDisplay(blocks);
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return shortenText(firstSentence.replace(/^["«]+|["»]+$/g, ""), 90);
}

function shouldReplaceSpeechText(text: string, slideNotes: string) {
  return !text || isGenericSpeechText(text) || (slideNotes && text.length < slideNotes.length / 2);
}

function narrationFromSlide(slide: PresentationDocument["slides"][number]) {
  return sanitizeDisplayText(`${slide.title}. ${slideBodyTextForDisplay(slide.blocks, slide.title)}`);
}

function isGenericSpeechText(text: string) {
  const lower = cleanText(text).toLowerCase();
  return [
    "добавлю несколько деталей",
    "почему этот раздел важен",
    "на этом слайде раскрывается раздел",
    "сегодня я расскажу о теме",
  ].some((phrase) => lower.includes(phrase));
}

function countTitles(titles: string[]) {
  return titles.reduce<Map<string, number>>((counts, title) => {
    const key = normalizeTitleKey(title);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
}

function shouldReplaceTitle(title: unknown) {
  const key = normalizeTitleKey(title);
  return !key || ["введение", "intro", "introduction", "слайд", "slide", "титульный слайд"].includes(key);
}

function normalizeTitleKey(title: unknown) {
  return cleanText(title).toLowerCase();
}

function fallbackSpeech(title: string) {
  return `На этом слайде нужно кратко раскрыть раздел "${title}" и объяснить его простыми словами.`;
}

function splitSentences(value: unknown) {
  return sanitizeDisplayText(value)
    .split(/(?<=[.!?])\s+|[;\n]+/)
    .map((item) => shortenText(item.trim(), 130))
    .filter(Boolean);
}

function uniqueShortItems(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const clean = shortenText(sanitizeDisplayText(item).replace(/^[-*]\s*/, ""), 130);
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

function sanitizeIcon(value: unknown) {
  const icon = cleanText(value).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return icon || "dot";
}

function dedupeConcepts(items: KeyConcept[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeVisualType(value: unknown, title: string, bullets: string[], slideKind: SlideKind): SlideVisual["type"] {
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
  if (slideKind === "section") return "schema";
  const text = [title, ...bullets].join(" ").toLowerCase();
  if (/\b(step|stage|process|first|second|then|next|algorithm)\b/.test(text)) return "process_diagram";
  if (/\b(compare|versus|vs|difference|similar|unlike)\b/.test(text)) return "comparison_diagram";
  if (/\b(cause|effect|because|consequence|impact|leads to)\b/.test(text)) return "cause_effect_diagram";
  if (/\b(before|after|change|became|transformation)\b/.test(text)) return "before_after_table";
  if (/\b(pros|cons|benefit|risk|advantage|disadvantage)\b/.test(text)) return "pros_cons_table";
  if (/\b(year|century|period|timeline|history|date)\b|\b\d{3,4}\b/.test(text)) return "timeline";
  if (/\b(connection|relationship|concept|map|network)\b/.test(text)) return "mind_map";
  return slideKind === "summary" ? "mind_map" : "schema";
}

function visualTitle(type: SlideVisual["type"]) {
  const titles: Record<SlideVisual["type"], string> = {
    process_diagram: "Процесс",
    comparison_diagram: "Сравнение",
    cause_effect_diagram: "Причина и следствие",
    before_after_table: "До и после",
    pros_cons_table: "Плюсы и минусы",
    timeline: "Хронология",
    mind_map: "Карта понятий",
    illustration: "Иллюстрация",
    schema: "Схема",
    image: "Визуальный пример",
    none: "",
  };
  return titles[type];
}

function fallbackRows(type: SlideVisual["type"], bullets: string[]) {
  if (!["comparison_diagram", "before_after_table", "pros_cons_table", "cause_effect_diagram"].includes(type)) return [];
  return bullets.slice(0, 4).map((item, index) => ({
    label: index === 0 ? "Главное" : `Пункт ${index + 1}`,
    left: item,
    right: "",
  }));
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function shortenText(value: string, maxLength: number) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function sentencePreview(value: string) {
  const text = cleanText(value);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3);

  return shortenText(sentences.length ? sentences.join(" ") : text, 320);
}
