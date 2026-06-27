import {
  buildSlideCanvas,
  ensureEditableCanvas,
  resolvePresentationTheme,
  type Highlight,
  type KeyConcept,
  type PresentationDocument,
  type SlideBlock,
  type SlideKind,
  type SlideVisual,
} from "@studydeck/shared";

type ProjectWithPresentation = {
  id?: string;
  presentation?: { document?: DisplayPresentationInput | null } | null;
};

type DisplayPresentationInput = Omit<PresentationDocument, "generatedText" | "narrativePlan"> & {
  generatedText?: string;
  narrativePlan?: PresentationDocument["narrativePlan"];
};

const GENERIC_NARRATION_PHRASES = [
  "в теме \"",
  "важен поворот к разделу",
  "дальше эту мысль можно развить через следующий смысловой шаг",
  "чтобы тема звучала последовательно и без резких переходов",
  "на первый план выходит",
  "эта деталь помогает увидеть практический смысл темы",
  "так объяснение становится конкретнее",
  "добавлю несколько деталей",
  "почему этот раздел важен",
  "на этом слайде раскрывается раздел",
  "на этом слайде нужно раскрыть раздел",
  "сегодня я расскажу о теме",
  "слайд \"",
  "слайд «",
  "объясняет часть темы",
  "раскрывает главную мысль",
  "опорный пункт",
  "опорные пункты",
  "затем стоит показать связь",
  "после этого можно закрепить",
  "текст на слайде",
  "основной смысл раскрывается",
  "основной рассказ раскрывает",
  "рассказе про",
  "рассказ про",
  "примеры. поэтому",
];

const GENERIC_SCREEN_TEXT_PHRASES = [
  "главная идея связана с темой",
  "материал стоит разбирать",
  "смысловым частым",
  "смысловым частям",
  "ключевые понятия помогают удержать структуру",
  "пример или визуальная схема",
  "визуальная схема делает объяснение",
  "на слайде показано",
  "этот слайд помогает",
  "этот раздел объясняет",
  "здесь собраны основные факты",
  "несуществующая тема",
  "несуществующие темы",
  "на картинке",
  "на изображении",
  "на схеме видно",
  "как видно на схеме",
  "как показано на картинке",
  "как показано на изображении",
  "нужно раскрыть через конкретные факты",
  "раскрыть через конкретные факты",
];

export function sanitizeProjectForDisplay<T extends ProjectWithPresentation>(project: T): T {
  const document = project.presentation?.document;
  if (!document) return project;
  const sanitizedDocument = sanitizePresentationForDisplay(document);

  return {
    ...project,
    presentation: {
      ...project.presentation,
      document: project.id ? useStoredImageUrls(sanitizedDocument, project.id) : sanitizedDocument,
    },
  };
}

export function useStoredImageUrls(document: PresentationDocument, projectId: string): PresentationDocument {
  return {
    ...document,
    slides: document.slides.map((slide) => {
      const assetBase = `/api/projects/${encodeURIComponent(projectId)}/slides/${encodeURIComponent(slide.id)}/assets`;
      const storedVisualImage = slide.visual.image?.objectKey ? slide.visual.image : undefined;
      const visualAssetUrl = `${assetBase}/visual-image`;
      const hasCustomMarker = slide.canvas?.elements.some((element) => element.id === `${slide.id}-custom-canvas-marker`);
      let canvas = slide.canvas;

      if (storedVisualImage && canvas && !hasCustomMarker && !canvas.elements.some((element) => element.type === "image")) {
        const generatedCanvas = buildSlideCanvas(
          {
            ...slide,
            visual: {
              ...slide.visual,
              image: { ...storedVisualImage, url: visualAssetUrl },
            },
          },
          document.presentationTheme || resolvePresentationTheme(document),
          {
            designDirection: document.designBrief?.slideDirections.find((direction) => direction.slideOrder === slide.order),
          },
        );
        canvas = {
          ...canvas,
          elements: [
            ...generatedCanvas.elements.filter((element) => element.type === "image"),
            ...canvas.elements,
          ],
        };
      }

      return {
        ...slide,
        visual: storedVisualImage
          ? {
              ...slide.visual,
              image: {
                ...storedVisualImage,
                url: visualAssetUrl,
              },
            }
          : slide.visual,
        canvas: canvas
          ? {
              ...canvas,
              elements: canvas.elements.map((element) =>
                element.type === "image" && element.objectKey
                  ? {
                      ...element,
                      url: storedVisualImage?.objectKey === element.objectKey
                        ? visualAssetUrl
                        : `${assetBase}/${encodeURIComponent(element.id)}`,
                    }
                  : element,
              ),
            }
          : canvas,
      };
    }),
  };
}

export function sanitizePresentationForDisplay(document: DisplayPresentationInput): PresentationDocument {
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
    const rawSpeakerNotes = cleanText(slide.speakerNotes);
    const cleanSpeakerNotes = sanitizeDisplayText(rawSpeakerNotes);
    const fallbackNotes = narrationFromParts(title, thesis, bullets, slideBodyTextForDisplay(blocks, title));
    const speakerNotes = !cleanSpeakerNotes || isGenericSpeechText(rawSpeakerNotes) || isGenericSpeechText(cleanSpeakerNotes) ? fallbackNotes : cleanSpeakerNotes;

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

  return ensureEditableCanvas({
    ...document,
    generatedText: sanitizeGeneratedTextForDisplay(document.generatedText),
    sources: [],
    narrativePlan: document.narrativePlan ?? [],
    presentationTheme: resolvePresentationTheme({
      title: document.title,
      scenario: document.scenario,
      level: document.level,
      presentationTheme: document.presentationTheme,
      designBrief: document.designBrief,
    }),
    slides,
    speechScript: slides.map((slide, index) => {
      const existing = document.speechScript.find((item) => item.slideOrder === slide.order) || document.speechScript[index];
      const rawText = cleanText(existing?.text);
      const text = sanitizeDisplayText(rawText);
      const slideNotes = sanitizeDisplayText(slide.speakerNotes);
      const fallbackText = isGenericSpeechText(slideNotes) ? narrationFromSlide(slide) : slideNotes;
      return {
        slideOrder: slide.order,
        slideTitle: shouldReplaceTitle(existing?.slideTitle) ? slide.title : sanitizeDisplayText(existing?.slideTitle || slide.title) || slide.title,
        text: isGenericSpeechText(rawText) || shouldReplaceSpeechText(text, fallbackText) ? fallbackText : text || fallbackText,
      };
    }),
  });
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
  const candidate = sentencePreview(sanitizeDisplayText(value));
  if (candidate && !isDuplicateDisplayText(candidate, fallback)) return candidate;
  const fromBlocks = slideBodyTextForDisplay(blocks, fallback);
  if (fromBlocks && !isDuplicateDisplayText(fromBlocks, fallback)) return fromBlocks;
  return fallback ? sentencePreview(`Главное здесь - ${fallback.replace(/[.!?]+$/g, "")}.`) : "";
}

function normalizeBullets(value: unknown, blocks: SlideBlock[], fallback: string, slideKind: SlideKind) {
  const items = Array.isArray(value) ? value.map(sanitizeDisplayText).filter(Boolean) : [];
  const blockItems = blocks.flatMap((block) => (block.type === "bullets" ? block.items : splitSentences("content" in block ? block.content : "")));
  const merged = uniqueShortItems([...items, ...blockItems]).filter((item) => !isDuplicateDisplayText(item, fallback));
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

function normalizeVisual(value: unknown, title: string, _bullets: string[], _slideKind: SlideKind): SlideVisual {
  const empty: SlideVisual = { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] };
  const candidate = value && typeof value === "object" ? (value as Partial<SlideVisual>) : {};
  const image = normalizeVisualImage(candidate.image);
  const requestedType = normalizeVisualType(candidate.type);
  const description = sanitizeDisplayText(candidate.description);
  const items = Array.isArray(candidate.items)
    ? candidate.items.map((item) => ({ label: sanitizeDisplayText(item?.label), text: sanitizeDisplayText(item?.text) })).filter((item) => item.label || item.text).slice(0, 8)
    : [];
  const rows = Array.isArray(candidate.rows)
    ? candidate.rows.map((row) => ({ label: sanitizeDisplayText(row?.label), left: sanitizeDisplayText(row?.left), right: sanitizeDisplayText(row?.right) })).filter((row) => row.label || row.left || row.right).slice(0, 8)
    : [];
  const completeRows = rows.filter((row) => row.left && row.right);
  const type = usefulVisualType(requestedType, items, completeRows);

  if (type === "none") {
    return { ...empty, description, ...(image ? { image } : {}) };
  }

  return {
    type,
    title: normalizeVisualTitle(candidate.title, title),
    description,
    leftLabel: sanitizeDisplayText(candidate.leftLabel),
    rightLabel: sanitizeDisplayText(candidate.rightLabel),
    items: type === "image" || type === "illustration" ? [] : items,
    rows: isRowVisual(type) ? completeRows : [],
    ...(image ? { image } : {}),
  };
}

function normalizeVisualImage(value: unknown): SlideVisual["image"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as NonNullable<SlideVisual["image"]>;
  const url = validImageUrl(candidate.url) ? candidate.url : "";
  if (!url) return undefined;

  return {
    url,
    objectKey: sanitizeDisplayText(candidate.objectKey),
    alt: sanitizeDisplayText(candidate.alt),
    query: sanitizeDisplayText(candidate.query),
    sourceUrl: validUrl(candidate.sourceUrl) ? candidate.sourceUrl : undefined,
    sourceTitle: sanitizeDisplayText(candidate.sourceTitle),
    provider: "tavily",
    contentType: sanitizeDisplayText(candidate.contentType),
  };
}

function normalizeVisualTitle(value: unknown, slideTitle: string) {
  const title = sanitizeDisplayText(value);
  if (!title || isGenericVisualTitle(title) || isDuplicateDisplayText(title, slideTitle)) return "";
  return title;
}

function isGenericVisualTitle(title: string) {
  const key = normalizeTitleKey(title);
  return ["visual example", "визуальный пример", "иллюстрация", "image"].includes(key);
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
    "сделай презентацию",
    "сделайте презентацию",
    "создай презентацию",
    "создайте презентацию",
    "нужно раскрыть через конкретные факты",
    "раскрыть через конкретные факты",
    ...GENERIC_NARRATION_PHRASES,
    ...GENERIC_SCREEN_TEXT_PHRASES,
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

function sanitizeGeneratedTextForDisplay(value: unknown) {
  return cleanMultilineText(value)
    .split("\n")
    .map((line) => {
      const text = line.trim();
      if (!text) return "";
      return /^Слайд\s+\d+\s*:/i.test(text) ? text : sanitizeDisplayText(text);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
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
    : [{ type: "callout", content: slideBodyTextForDisplay([], `${fallback}: главное сказать коротко и понятно.`) }];
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
  return narrationFromParts(slide.title, slide.thesis, slide.bullets, body);
}

function narrationFromParts(title: string, thesis: string, bullets: string[], body: string) {
  const points = bullets.length ? bullets : splitSentences(body);
  const main = thesis || body || title;
  const firstPoint = points[0] || main;
  const secondPoint = points[1] || firstPoint;
  const thirdPoint = points[2] || secondPoint;

  return sanitizeDisplayText(
    [
      `Тема "${title}" становится понятнее через главный тезис: ${sentenceFragment(main)}.`,
      `На первый план выходит ${sentenceFragment(firstPoint)}, потому что эта деталь помогает увидеть практический смысл вопроса.`,
      `Другая сторона темы связана с тем, что ${sentenceFragment(secondPoint)}.`,
      `Так объяснение становится конкретнее, а ${sentenceFragment(thirdPoint)} добавляет нужную деталь без перегрузки фактами.`,
      "В результате материал воспринимается не как набор формулировок, а как последовательное объяснение с понятным выводом.",
    ].join(" "),
  );
}

function isGenericSpeechText(text: string) {
  const lower = cleanText(text).toLowerCase();
  return GENERIC_NARRATION_PHRASES.some((phrase) => lower.includes(phrase));
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

function isDuplicateDisplayText(value: string, reference: string) {
  const left = normalizeComparableText(value);
  const right = normalizeComparableText(reference);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return shorter.length >= 18 && longer.includes(shorter);
}

function normalizeComparableText(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(value: unknown) {
  return sanitizeDisplayText(value)
    .split(/(?<=[.!?])\s+|[;\n]+/)
    .map((item) => shortenText(item.trim(), 130))
    .filter(Boolean);
}

function sentenceFragment(value: string) {
  const text = cleanText(value).replace(/[.!?]+$/g, "");
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : "";
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

function normalizeVisualType(value: unknown): SlideVisual["type"] {
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
  return "none";
}

function usefulVisualType(
  type: SlideVisual["type"],
  items: SlideVisual["items"],
  rows: SlideVisual["rows"],
): SlideVisual["type"] {
  if (isRowVisual(type)) {
    return rows.length >= 1 ? type : "none";
  }

  if (["process_diagram", "timeline", "mind_map", "schema"].includes(type)) {
    return items.filter((item) => item.label || item.text).length >= 2 ? type : "none";
  }

  if (type === "illustration" || type === "image") return type;

  return type === "none" ? "none" : type;
}

function isRowVisual(type: SlideVisual["type"]) {
  return ["comparison_diagram", "before_after_table", "pros_cons_table", "cause_effect_diagram"].includes(type);
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

function cleanMultilineText(value: unknown) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validUrl(value: unknown): value is string {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function validImageUrl(value: unknown): value is string {
  const text = String(value || "");
  if (/^\/api\/projects\/[^/]+\/slides\/[^/]+\/assets\/[^/]+$/.test(text)) {
    return true;
  }
  return validUrl(text);
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
