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
  const slides = document.slides.map((slide, index) => {
    const blocks = normalizeBlocksForDisplay(slide.blocks, slide.title);
    const speakerNotes = sanitizeDisplayText(slide.speakerNotes) || fallbackSpeech(slide.title);

    return {
      ...slide,
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
      return {
        slideOrder: slide.order,
        slideTitle: sanitizeDisplayText(existing?.slideTitle || slide.title) || slide.title,
        text: sanitizeDisplayText(existing?.text) || slide.speakerNotes,
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
