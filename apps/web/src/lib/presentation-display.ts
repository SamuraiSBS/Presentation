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

function normalizeKeyConcepts(_value: unknown, _title: string, _bullets: string[], _slideKind: SlideKind): KeyConcept[] {
  return [];
}

function normalizeHighlights(_value: unknown, _thesis: string, _bullets: string[], _slideKind: SlideKind): Highlight[] {
  return [];
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
  const body = slideStructuredTextForDisplay(slide);
  const points = slide.bullets.length ? slide.bullets : splitSentences(body);
  return sanitizeDisplayText(
    [
      `Слайд "${slide.title}" раскрывает главную мысль: ${lowercaseFirst(slide.thesis || body || slide.title)}`,
      `Первый опорный пункт помогает понять тему конкретнее: ${lowercaseFirst(points[0] || slide.title)}`,
      `Второй пункт показывает, как эта идея связана с остальным материалом: ${lowercaseFirst(points[1] || points[0] || slide.title)}`,
      `Третий пункт закрепляет объяснение через важную деталь: ${lowercaseFirst(points[2] || points[1] || points[0] || slide.title)}`,
      "Поэтому текст на слайде остается коротким, а основной рассказ раскрывает смысл связно и последовательно.",
    ].join(" "),
  );
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
  return sanitizeDisplayText(
    [
      `Слайд "${title}" вводит важную часть темы и задает направление объяснения.`,
      "Сначала стоит назвать главную мысль простыми словами.",
      "Затем нужно показать, какие пункты на слайде помогают ее понять.",
      "После этого полезно связать эти пункты с примером или выводом.",
      "Так слушателю легче увидеть не набор слов, а цельный рассказ.",
    ].join(" "),
  );
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

function lowercaseFirst(value: string) {
  const text = cleanText(value).replace(/[.!?]+$/g, "");
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}.` : "";
}
