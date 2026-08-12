import {
  presentationSchema,
  resolvePresentationTheme,
  type PresentationTheme,
} from "@studydeck/shared";

export type ExportTheme = PresentationTheme & {
  pptx: {
    background: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    muted: string;
    accent: string;
    accentAlt: string;
    line: string;
  };
};

type PresentationSlide = ReturnType<typeof presentationSchema.parse>["slides"][number];

/**
 * Shared semantic projection used by both PPTX and HTML/PDF renderers.
 * It intentionally knows presentation data only; storage and renderer APIs
 * stay in their respective slices.
 */
export function exportTheme(presentation: ReturnType<typeof presentationSchema.parse>): ExportTheme {
  const theme = resolvePresentationTheme({
    title: presentation.title,
    scenario: presentation.scenario,
    level: presentation.level,
    presentationTheme: presentation.presentationTheme,
    designBrief: presentation.designBrief,
  });

  return {
    ...theme,
    pptx: {
      background: pptxColor(theme.colors.background),
      surface: pptxColor(theme.colors.surface),
      surfaceAlt: pptxColor(theme.colors.surfaceAlt),
      text: pptxColor(theme.colors.text),
      muted: pptxColor(theme.colors.muted),
      accent: pptxColor(theme.colors.accent),
      accentAlt: pptxColor(theme.colors.accentAlt),
      line: pptxColor(theme.colors.line),
    },
  };
}

export function pptxColor(value: string) {
  return value.replace(/^#/, "").toUpperCase();
}

export function slideBodyText(slide: PresentationSlide) {
  const structured = [
    slide.thesis,
    ...slide.bullets,
    definitionText(slide),
    visualText(slide),
  ]
    .filter(Boolean)
    .join(" ");
  const text = structured || slide.blocks
    .flatMap((block) => (block.type === "bullets" ? block.items : "content" in block ? [block.content] : []))
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  return sentencePreview(text);
}

export function quoteText(slide: PresentationSlide) {
  const quote = slide.blocks.find((block): block is Extract<typeof slide.blocks[number], { type: "quote" }> => block.type === "quote");
  return quote?.content || slide.thesis || slideBodyText(slide);
}

export function sequenceItems(slide: PresentationSlide) {
  const visualItems = slide.visual.items.map((item) => item.label || item.text).filter(Boolean);
  const blockItems = slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : "content" in block ? [block.content] : []));
  return (visualItems.length ? visualItems : slide.bullets.length ? slide.bullets : blockItems.length ? blockItems : [slide.thesis || slide.title]).filter(Boolean);
}

export function comparisonRows(slide: PresentationSlide) {
  if (slide.visual.rows.length) return slide.visual.rows;
  return [{
    label: slide.title,
    left: slide.bullets[0] || slide.thesis,
    right: slide.bullets[1] || slideBodyText(slide),
  }];
}

function definitionText(slide: PresentationSlide) {
  return slide.definition ? `${slide.definition.term}: ${slide.definition.text}` : "";
}

function visualText(slide: PresentationSlide) {
  const visual = slide.visual;
  if (!visual || visual.type === "none") return "";
  if (visual.diagram?.fallback) return [visual.diagram.title || visual.title || visual.type, visual.diagram.fallback].filter(Boolean).join(": ");
  const rows = visual.rows.map((row) => [row.label, row.left, row.right].filter(Boolean).join(": ")).filter(Boolean);
  const items = visual.items.map((item) => [item.label, item.text].filter(Boolean).join(": ")).filter(Boolean);
  const content = (rows.length ? rows : items).slice(0, 4).join("; ");
  return [visual.title || visual.type, content].filter(Boolean).join(": ");
}

function sentencePreview(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3);
  const preview = sentences.length ? sentences.join(" ") : text;
  return preview.length > 320 ? `${preview.slice(0, 317).trim()}...` : preview;
}
