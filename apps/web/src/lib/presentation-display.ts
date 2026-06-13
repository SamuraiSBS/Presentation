import type { PresentationDocument, SlideBlock } from "@studydeck/shared";

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
    const speakerNotes = sanitizeDisplayText(slide.speakerNotes) || fallbackSpeech(title);

    return {
      ...slide,
      title,
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
  return shortenText(
    sanitizeDisplayText(
      blocks
        .flatMap((block) => (block.type === "bullets" ? block.items : "content" in block ? [block.content] : []))
        .filter(Boolean)
        .slice(0, 2)
        .join(" "),
    ) || fallback,
    230,
  );
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
  return [
    {
      type: "callout",
      content: slideBodyTextForDisplay(blocks, `Коротко раскрывается тема: ${fallback}.`),
    },
  ];
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

function cleanText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function shortenText(value: string, maxLength: number) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}
