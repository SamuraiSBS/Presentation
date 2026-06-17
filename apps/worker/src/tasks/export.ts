import type { Job } from "bullmq";
import { createRequire } from "node:module";
import { presentationSchema, resolvePresentationTheme, type PresentationTheme } from "@studydeck/shared";
import { getPrisma } from "../prisma.js";
import { putObjectBuffer, readObjectBuffer } from "../storage.js";

const require = createRequire(import.meta.url);
const PptxGenConstructor = require("pptxgenjs") as new () => {
  layout: string;
  author: string;
  subject: string;
  title: string;
  lang: string;
  theme: Record<string, unknown>;
  ShapeType: { rect: string; roundRect: string };
  defineLayout: (layout: { name: string; width: number; height: number }) => void;
  addSlide: () => any;
  write: (options: { outputType: "nodebuffer" }) => Promise<Buffer>;
};

const WIDE_LAYOUT = { name: "STUDYDECK_WIDE", width: 40 / 3, height: 7.5 };
type ExportTheme = PresentationTheme & {
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

export async function handleExportJob(job: Job<{ exportId: string; projectId: string; type: "pdf" | "pptx" }>) {
  const prisma = getPrisma();
  const { exportId, projectId, type } = job.data;
  await prisma.export.update({ where: { id: exportId }, data: { status: "processing" } });

  try {
    const presentationRow = await prisma.presentation.findUniqueOrThrow({ where: { projectId } });
    const presentation = presentationSchema.parse(presentationRow.document);
    const key = `projects/${projectId}/exports/${exportId}.${type}`;
    const buffer = type === "pptx" ? await createPptx(presentation) : createPdfPlaceholder(presentation);
    const contentType =
      type === "pptx"
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : "application/pdf";

    await putObjectBuffer(key, buffer, contentType);
    await prisma.export.update({ where: { id: exportId }, data: { status: "ready", objectKey: key } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    await prisma.export.update({ where: { id: exportId }, data: { status: "failed", error: message } });
    throw error;
  }
}

export async function createPptx(presentation: ReturnType<typeof presentationSchema.parse>) {
  const pptx = new PptxGenConstructor();
  pptx.defineLayout(WIDE_LAYOUT);
  pptx.layout = WIDE_LAYOUT.name;
  pptx.author = "StudyDeck AI";
  pptx.subject = presentation.scenario;
  pptx.title = presentation.title;
  pptx.lang = "ru-RU";
  const theme = exportTheme(presentation);
  pptx.theme = {
    headFontFace: theme.fonts.heading,
    bodyFontFace: theme.fonts.body,
    lang: "ru-RU",
  };

  for (const item of presentation.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: theme.pptx.background };
    const imageData = await readSlideImageData(item);

    if (imageData && (item.slideKind === "title" || item.slideKind === "section")) {
      slide.addImage({ data: imageData, x: 0, y: 0, w: 13.333, h: 7.5 });
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 13.333,
        h: 7.5,
        fill: { color: theme.pptx.background, transparency: theme.mood === "dark" ? 10 : 18 },
        line: { transparency: 100 },
      });
      renderSlideBackground(pptx, slide, item, theme, 38);
      slide.addText(item.title, {
        x: 0.9,
        y: 2.15,
        w: 11.55,
        h: 1.25,
        fontFace: theme.fonts.heading,
        fontSize: 36,
        bold: true,
        color: theme.pptx.text,
        align: "center",
        valign: "mid",
        fit: "shrink",
      });

      slide.addText(slideBodyText(item), {
        x: 1.65,
        y: 3.65,
        w: 10,
        h: 1.25,
        fontFace: theme.fonts.body,
        fontSize: 19,
        color: theme.pptx.muted,
        align: "center",
        valign: "mid",
        fit: "shrink",
      });
    } else {
      renderSlideBackground(pptx, slide, item, theme);
      renderContentSlide(pptx, slide, item, imageData, theme);
    }

    slide.addNotes(item.speakerNotes);
  }

  return pptx.write({ outputType: "nodebuffer" }) as Promise<Buffer>;
}

function renderContentSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  imageData: string | null,
  theme: ExportTheme,
) {
  const layout = item.layout;

  if (imageData && layout !== "image-focus") {
    return renderDefaultContentSlide(slide, item, imageData, theme);
  }

  if (layout === "statement") return renderStatementSlide(slide, item, theme);
  if (layout === "quote") return renderQuoteSlide(slide, item, theme);
  if (layout === "definition") return renderDefinitionSlide(pptx, slide, item, theme);
  if (layout === "timeline" || layout === "process") return renderSequenceSlide(pptx, slide, item, theme);
  if (layout === "comparison" || layout === "two-column") return renderComparisonSlide(pptx, slide, item, theme);
  if (layout === "image-focus" && imageData) return renderImageFocusSlide(slide, item, imageData, theme);
  if (layout === "case-study") return renderThreePanelSlide(pptx, slide, item, ["Ситуация", "Действие", "Результат"], theme);
  if (layout === "question-answer") return renderQuestionAnswerSlide(pptx, slide, item, theme);
  if (layout === "myth-fact") return renderThreePanelSlide(pptx, slide, item, ["Миф", "Факт"], theme);
  if (layout === "metrics") return renderMetricsSlide(pptx, slide, item, theme);
  renderDefaultContentSlide(slide, item, imageData, theme);
}

function renderSlideTitle(slide: any, title: string, theme: ExportTheme, options: { centered?: boolean; width?: number; fontSize?: number } = {}) {
  slide.addText(title, {
    x: options.centered ? 1.05 : 0.72,
    y: 0.58,
    w: options.width || (options.centered ? 11.2 : 11.9),
    h: 0.9,
    fontFace: theme.fonts.heading,
    fontSize: options.fontSize || 30,
    bold: true,
    color: theme.pptx.text,
    align: options.centered ? "center" : "left",
    valign: "mid",
    fit: "shrink",
  });
}

function renderSlideBackground(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
  transparencyOffset = 0,
) {
  const variant = slideBackgroundVariant(item);
  const soft = Math.min(88, 70 + transparencyOffset);
  const medium = Math.min(82, 58 + transparencyOffset);

  if (variant === "title") {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 4.1, h: 7.5, fill: { color: theme.pptx.accent, transparency: medium }, line: { transparency: 100 } });
    slide.addShape(pptx.ShapeType.rect, { x: 10.8, y: 0, w: 2.53, h: 2.4, fill: { color: theme.pptx.accentAlt, transparency: soft }, line: { transparency: 100 } });
    return;
  }

  if (variant === "section") {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 2.15, h: 7.5, fill: { color: theme.pptx.surfaceAlt, transparency: medium }, line: { transparency: 100 } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 3.45, w: 13.333, h: 0.18, fill: { color: theme.pptx.accent, transparency: soft }, line: { transparency: 100 } });
    return;
  }

  if (variant === "summary") {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 5.95, w: 13.333, h: 1.55, fill: { color: theme.pptx.surfaceAlt, transparency: medium }, line: { transparency: 100 } });
    slide.addShape(pptx.ShapeType.rect, { x: 10.45, y: 0, w: 2.88, h: 7.5, fill: { color: theme.pptx.accentAlt, transparency: soft }, line: { transparency: 100 } });
    return;
  }

  if (variant === "v1") {
    slide.addShape(pptx.ShapeType.rect, { x: 8.45, y: 0, w: 4.88, h: 7.5, fill: { color: theme.pptx.surfaceAlt, transparency: medium }, line: { transparency: 100 } });
    slide.addShape(pptx.ShapeType.rect, { x: 9.25, y: 5.6, w: 3.35, h: 0.42, fill: { color: theme.pptx.accentAlt, transparency: soft }, line: { transparency: 100 } });
    return;
  }

  if (variant === "v2") {
    for (let x = 0.35; x < 13.2; x += 1.25) {
      slide.addShape(pptx.ShapeType.rect, { x, y: 0.25, w: 0.03, h: 7, fill: { color: theme.pptx.line, transparency: 72 + transparencyOffset / 2 }, line: { transparency: 100 } });
    }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 3.2, h: 1.1, fill: { color: theme.pptx.accent, transparency: soft }, line: { transparency: 100 } });
    return;
  }

  if (variant === "v3") {
    slide.addShape(pptx.ShapeType.rect, { x: 0.28, y: 0.25, w: 12.77, h: 7.0, fill: { color: theme.pptx.background, transparency: 100 }, line: { color: theme.pptx.line, transparency: 18 + transparencyOffset / 3 } });
    slide.addShape(pptx.ShapeType.rect, { x: 0.55, y: 0.52, w: 12.23, h: 6.46, fill: { color: theme.pptx.background, transparency: 100 }, line: { color: theme.pptx.accent, transparency: 62 + transparencyOffset / 3 } });
    return;
  }

  if (variant === "v4") {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 3.8, h: 7.5, fill: { color: theme.pptx.surfaceAlt, transparency: medium }, line: { transparency: 100 } });
    slide.addShape(pptx.ShapeType.rect, { x: 9.8, y: 0, w: 3.53, h: 7.5, fill: { color: theme.pptx.accentAlt, transparency: soft }, line: { transparency: 100 } });
    return;
  }

  if (variant === "v5") {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 1.25, fill: { color: theme.pptx.surfaceAlt, transparency: medium }, line: { transparency: 100 } });
    slide.addShape(pptx.ShapeType.rect, { x: 11.25, y: 0, w: 2.08, h: 7.5, fill: { color: theme.pptx.accent, transparency: soft }, line: { transparency: 100 } });
    return;
  }

  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 5.1, w: 13.333, h: 2.4, fill: { color: theme.pptx.surfaceAlt, transparency: medium }, line: { transparency: 100 } });
  slide.addShape(pptx.ShapeType.rect, { x: 0.2, y: 0.2, w: 2.2, h: 0.18, fill: { color: theme.pptx.accent, transparency: soft }, line: { transparency: 100 } });
}

function slideBackgroundVariant(item: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  if (item.slideKind === "title") return "title";
  if (item.slideKind === "section") return "section";
  if (item.slideKind === "summary") return "summary";
  return `v${(item.order - 1) % 6}`;
}

function renderStatementSlide(slide: any, item: ReturnType<typeof presentationSchema.parse>["slides"][number], theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme, { centered: true, fontSize: 30 });
  slide.addText(slideBodyText(item), {
    x: 1.35,
    y: 2.05,
    w: 10.6,
    h: 2.85,
    fontFace: theme.fonts.heading,
    fontSize: 30,
    bold: true,
    color: theme.pptx.text,
    align: "center",
    valign: "mid",
    fit: "shrink",
  });
}

function renderQuoteSlide(slide: any, item: ReturnType<typeof presentationSchema.parse>["slides"][number], theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme);
  slide.addText(`"${quoteText(item)}"`, {
    x: 1.1,
    y: 1.95,
    w: 11.1,
    h: 2.6,
    fontFace: theme.fonts.heading,
    fontSize: 27,
    bold: true,
    italic: true,
    color: theme.pptx.text,
    align: "center",
    valign: "mid",
    fit: "shrink",
  });
  if (item.bullets[0]) {
    slide.addText(item.bullets[0], {
      x: 2.1,
      y: 4.86,
      w: 9.1,
      h: 0.62,
      fontFace: theme.fonts.body,
      fontSize: 15,
      color: theme.pptx.muted,
      align: "center",
      fit: "shrink",
    });
  }
}

function renderDefinitionSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme);
  const definition = item.definition || { term: item.title, text: item.thesis || slideBodyText(item) };
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.9,
    y: 1.7,
    w: 11.55,
    h: 3.45,
    rectRadius: 0.08,
    fill: { color: theme.pptx.surfaceAlt },
    line: { color: theme.pptx.line },
  });
  slide.addText(definition.term, {
    x: 1.25,
    y: 2.02,
    w: 10.8,
    h: 0.82,
    fontFace: theme.fonts.heading,
    fontSize: 28,
    bold: true,
    color: theme.pptx.text,
    fit: "shrink",
  });
  slide.addText(definition.text, {
    x: 1.25,
    y: 3.05,
    w: 10.8,
    h: 1.35,
    fontFace: theme.fonts.body,
    fontSize: 18,
    color: theme.pptx.muted,
    fit: "shrink",
  });
}

function renderSequenceSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme);
  const items = sequenceItems(item).slice(0, 5);
  const width = 11.7 / Math.max(items.length, 1);
  items.forEach((text, index) => {
    const x = 0.82 + index * width;
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 2.12,
      w: width - 0.16,
      h: 2.7,
      fill: { color: theme.pptx.surface },
      line: { color: theme.pptx.line },
    });
    slide.addText(String(index + 1), {
      x: x + 0.18,
      y: 2.32,
      w: 0.45,
      h: 0.36,
      fontFace: theme.fonts.body,
      fontSize: 13,
      bold: true,
      color: "FFFFFF",
      fill: { color: theme.pptx.text },
      align: "center",
      valign: "mid",
    });
    slide.addText(text, {
      x: x + 0.18,
      y: 2.95,
      w: width - 0.52,
      h: 1.35,
      fontFace: theme.fonts.body,
      fontSize: 14,
      color: theme.pptx.muted,
      fit: "shrink",
    });
  });
}

function renderComparisonSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme);
  const rows = comparisonRows(item).slice(0, 3);
  const leftLabel = item.visual.leftLabel || "Первое";
  const rightLabel = item.visual.rightLabel || "Второе";
  slide.addText(leftLabel, { x: 0.9, y: 1.7, w: 5.55, h: 0.42, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  slide.addText(rightLabel, { x: 6.9, y: 1.7, w: 5.55, h: 0.42, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  rows.forEach((row, index) => {
    const y = 2.18 + index * 1.22;
    for (const [x, text] of [[0.9, row.left || row.label], [6.9, row.right || row.label]] as const) {
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 5.55, h: 0.96, fill: { color: theme.pptx.surface }, line: { color: theme.pptx.line } });
      slide.addText(text, { x: x + 0.2, y: y + 0.16, w: 5.15, h: 0.56, fontFace: theme.fonts.body, fontSize: 14, color: theme.pptx.muted, fit: "shrink" });
    }
  });
}

function renderImageFocusSlide(slide: any, item: ReturnType<typeof presentationSchema.parse>["slides"][number], imageData: string, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme, { width: 5.5, fontSize: 28 });
  slide.addText(item.thesis || slideBodyText(item), {
    x: 0.82,
    y: 2.0,
    w: 5.25,
    h: 2.4,
    fontFace: theme.fonts.body,
    fontSize: 18,
    color: theme.pptx.muted,
    fit: "shrink",
  });
  slide.addImage({ data: imageData, x: 6.65, y: 0.72, w: 5.95, h: 5.75 });
  const attribution = imageAttribution(item);
  if (attribution) {
    slide.addText(attribution, { x: 6.65, y: 6.58, w: 5.95, h: 0.24, fontFace: theme.fonts.body, fontSize: 7, color: theme.pptx.muted, align: "right", fit: "shrink" });
  }
}

function renderThreePanelSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  labels: string[],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme);
  const items = sequenceItems(item);
  const width = 11.5 / labels.length;
  labels.forEach((label, index) => {
    const x = 0.92 + index * width;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.0, w: width - 0.18, h: 2.5, fill: { color: index % 2 ? theme.pptx.surface : theme.pptx.surfaceAlt }, line: { color: theme.pptx.line } });
    slide.addText(label, { x: x + 0.22, y: 2.24, w: width - 0.62, h: 0.35, fontFace: theme.fonts.heading, fontSize: 12, bold: true, color: theme.pptx.text });
    slide.addText(items[index] || item.thesis || slideBodyText(item), { x: x + 0.22, y: 2.86, w: width - 0.62, h: 1.08, fontFace: theme.fonts.body, fontSize: 14, color: theme.pptx.muted, fit: "shrink" });
  });
}

function renderQuestionAnswerSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme, { centered: true, fontSize: 31 });
  slide.addShape(pptx.ShapeType.roundRect, { x: 1.55, y: 2.12, w: 10.2, h: 2.2, fill: { color: theme.pptx.surfaceAlt }, line: { color: theme.pptx.line } });
  slide.addText("Ответ", { x: 1.95, y: 2.38, w: 9.4, h: 0.32, fontFace: theme.fonts.heading, fontSize: 12, bold: true, color: theme.pptx.text });
  slide.addText(item.thesis || slideBodyText(item), { x: 1.95, y: 2.95, w: 9.4, h: 0.85, fontFace: theme.fonts.body, fontSize: 18, color: theme.pptx.muted, fit: "shrink" });
}

function renderMetricsSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme);
  const items = sequenceItems(item).slice(0, 4);
  items.forEach((text, index) => {
    const x = 0.9 + index * 3;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.0, w: 2.72, h: 2.35, fill: { color: theme.pptx.surface }, line: { color: theme.pptx.line } });
    slide.addText(metricLead(text, index), { x: x + 0.18, y: 2.28, w: 2.36, h: 0.46, fontFace: theme.fonts.heading, fontSize: 22, bold: true, color: theme.pptx.accentAlt, fit: "shrink" });
    slide.addText(text, { x: x + 0.18, y: 3.08, w: 2.36, h: 0.78, fontFace: theme.fonts.body, fontSize: 12, color: theme.pptx.muted, fit: "shrink" });
  });
}

function renderDefaultContentSlide(slide: any, item: ReturnType<typeof presentationSchema.parse>["slides"][number], imageData: string | null, theme: ExportTheme) {
  const hasSideImage = Boolean(imageData);
  renderSlideTitle(slide, item.title, theme, { centered: !hasSideImage, width: hasSideImage ? 5.5 : 11.9, fontSize: hasSideImage ? 28 : 34 });

  slide.addText(slideBodyText(item), {
    x: hasSideImage ? 0.82 : 1.5,
    y: hasSideImage ? 2.05 : 3.55,
    w: hasSideImage ? 5.35 : 10.33,
    h: hasSideImage ? 3.5 : 1.45,
    fontFace: theme.fonts.body,
    fontSize: hasSideImage ? 18 : 19,
    color: theme.pptx.muted,
    align: hasSideImage ? "left" : "center",
    valign: "mid",
    breakLine: false,
    fit: "shrink",
  });

  if (imageData) {
    slide.addImage({ data: imageData, x: 6.72, y: 0.68, w: 5.9, h: 5.85 });
    const attribution = imageAttribution(item);
    if (attribution) {
      slide.addText(attribution, {
        x: 6.72,
        y: 6.62,
        w: 5.9,
        h: 0.24,
        fontFace: theme.fonts.body,
        fontSize: 7,
        color: theme.pptx.muted,
        align: "right",
        fit: "shrink",
      });
    }
  }
}

function createPdfPlaceholder(presentation: ReturnType<typeof presentationSchema.parse>) {
  const text = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length 72>>stream
BT /F1 18 Tf 72 720 Td (${escapePdf(presentation.title)} - PDF export queued) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000204 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
326
%%EOF`;
  return Buffer.from(text, "utf8");
}

function exportTheme(presentation: ReturnType<typeof presentationSchema.parse>): ExportTheme {
  const theme = resolvePresentationTheme({
    title: presentation.title,
    scenario: presentation.scenario,
    level: presentation.level,
    presentationTheme: presentation.presentationTheme,
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

function pptxColor(value: string) {
  return value.replace(/^#/, "").toUpperCase();
}

function slideBodyText(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
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

function quoteText(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const quote = slide.blocks.find((block): block is Extract<typeof slide.blocks[number], { type: "quote" }> => block.type === "quote");
  return quote?.content || slide.thesis || slideBodyText(slide);
}

function sequenceItems(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const visualItems = slide.visual.items.map((item) => item.label || item.text).filter(Boolean);
  const blockItems = slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : "content" in block ? [block.content] : []));
  return (visualItems.length ? visualItems : slide.bullets.length ? slide.bullets : blockItems.length ? blockItems : [slide.thesis || slide.title]).filter(Boolean);
}

function comparisonRows(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  if (slide.visual.rows.length) return slide.visual.rows;
  return [
    {
      label: slide.title,
      left: slide.bullets[0] || slide.thesis,
      right: slide.bullets[1] || slideBodyText(slide),
    },
  ];
}

function metricLead(text: string, index: number) {
  return text.match(/\d+[.,]?\d*\s*[%\wА-Яа-я-]*/u)?.[0] || String(index + 1).padStart(2, "0");
}

function definitionText(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  return slide.definition ? `${slide.definition.term}: ${slide.definition.text}` : "";
}

function visualText(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const visual = slide.visual;
  if (!visual || visual.type === "none") return "";
  const rows = visual.rows.map((row) => [row.label, row.left, row.right].filter(Boolean).join(": ")).filter(Boolean);
  const items = visual.items.map((item) => [item.label, item.text].filter(Boolean).join(": ")).filter(Boolean);
  const content = (rows.length ? rows : items).slice(0, 4).join("; ");
  return [visual.title || visual.type, content].filter(Boolean).join(": ");
}

async function readSlideImageData(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const image = slide.visual.image;
  if (!image?.objectKey) return null;

  try {
    const buffer = await readObjectBuffer(image.objectKey);
    const contentType = image.contentType || contentTypeFromObjectKey(image.objectKey);
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn(`Could not read slide image ${image.objectKey}:`, error);
    return null;
  }
}

function contentTypeFromObjectKey(objectKey: string) {
  const lower = objectKey.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function imageAttribution(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const image = slide.visual.image;
  if (!image) return "";
  return [image.sourceTitle, image.sourceUrl].filter(Boolean).join(" - ");
}

function escapePdf(value: string) {
  return value.replace(/[()\\]/g, "");
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
