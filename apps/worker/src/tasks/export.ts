import type { Job } from "bullmq";
import { createRequire } from "node:module";
import sharp from "sharp";
import {
  ensureEditableCanvas,
  canvasTextLineHeight,
  canvasBackgroundCss,
  formatSlideAttribution,
  hasMeasurableValue,
  metricLead,
  presentationSchema,
  resolvePresentationTheme,
  sortCanvasElements,
  type CanvasElement,
  type CanvasImageElement,
  type CanvasShapeElement,
  type CanvasTextElement,
  type PresentationTheme,
  type SlideCanvas,
} from "@studydeck/shared";
import { captureExportError, errorLogFields, logger, type TraceCarrier, withTraceSpan } from "../observability.js";
import { getPrisma } from "../prisma.js";
import { putObjectBuffer, readObjectBuffer } from "../storage.js";
import { recordCostEvent, runWithUsageContext } from "../usage-ledger.js";
import { renderHtmlToPdf } from "./pdf-renderer.js";
import {
  handleComplianceReportExportJob,
  type ComplianceReportExportJobData,
} from "./defense/jobs.js";
import { preparePresentationForExport } from "./export-preflight.js";

const require = createRequire(import.meta.url);
const PptxGenConstructor = require("pptxgenjs") as new () => {
  layout: string;
  author: string;
  subject: string;
  title: string;
  lang: string;
  theme: Record<string, unknown>;
  ShapeType: Record<string, string>;
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

type ExportJobData = {
  exportId: string;
  projectId: string;
  type: "pdf" | "pptx";
  traceContext?: TraceCarrier;
};

export async function handleExportJob(job: Job<ExportJobData | ComplianceReportExportJobData>) {
  if (job.name === "export-compliance-report") {
    return handleComplianceReportExportJob(job as Job<ComplianceReportExportJobData>);
  }
  if (job.name !== "export-presentation") {
    throw new Error(`Unsupported export job: ${job.name}`);
  }
  const exportJob = job as Job<ExportJobData>;
  const prisma = getPrisma();
  const { projectId } = exportJob.data;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
  if (!project) throw new Error("Export project was not found");
  return runWithUsageContext({ userId: project.userId, projectId, queueJobId: exportJob.id ? String(exportJob.id) : undefined, stage: "export" }, () => runExportJob(exportJob));
}

async function runExportJob(job: Job<ExportJobData>) {
  const prisma = getPrisma();
  const { exportId, projectId, type } = job.data;
  await prisma.export.update({ where: { id: exportId }, data: { status: "processing" } });

  try {
    const presentationRow = await prisma.presentation.findUniqueOrThrow({ where: { projectId } });
    const presentation = presentationSchema.parse(presentationRow.document);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, title: true, prompt: true, scenario: true, level: true, mode: true, slideCount: true },
    });
    const preflight = await preparePresentationForExport(presentation, {
      format: type,
      project,
      readObject: readObjectBuffer,
    });
    logger.info({
      projectId,
      exportId,
      format: type,
      passed: preflight.report.passed,
      repaired: preflight.report.repaired,
      unresolvedCategories: [...new Set(preflight.report.slideIssues.flatMap((issue) => issue.categories))],
      slideOrders: preflight.report.slideIssues
        .map((issue) => preflight.document.slides.find((slide) => slide.id === issue.slideId)?.order)
        .filter((order): order is number => Boolean(order)),
      fallback: preflight.report.repaired ? "quality_pipeline_and_canvas_rebuild" : "none",
    }, "presentation export preflight");
    if (!preflight.report.passed) {
      throw new Error("Presentation export preflight could not produce a safe document");
    }
    const key = `projects/${projectId}/exports/${exportId}.${type}`;
    const buffer = await withTraceSpan("generation.export", {
      "studydeck.project_id": projectId,
      "studydeck.job_id": String(job.id || ""),
      "studydeck.export_id": exportId,
      "studydeck.export_type": type,
      "studydeck.stage": "export",
    }, () => type === "pptx" ? createPptx(preflight.document) : createPdf(preflight.document), job.data.traceContext);
    const contentType =
      type === "pptx"
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : "application/pdf";

    await putObjectBuffer(key, buffer, contentType);
    await recordCostEvent({
      idempotencyKey: `export:${exportId}:compute`,
      category: "export_compute",
      provider: "studydeck-worker",
      quantity: "1",
      unit: "export",
      unitPrice: process.env.EXPORT_COMPUTE_PRICE_RUB,
      currency: "RUB",
      measurement: "calculated",
      exportId,
    });
    await recordCostEvent({
      idempotencyKey: `export:${exportId}:storage`,
      category: "storage",
      provider: process.env.S3_ENDPOINT?.includes("localhost") || process.env.S3_ENDPOINT?.includes("minio") ? "minio" : "object_storage",
      quantity: String(buffer.length),
      unit: "stored_byte_month",
      unitPrice: process.env.STORAGE_PRICE_USD_PER_BYTE_MONTH,
      currency: "USD",
      measurement: "calculated",
      exportId,
    });
    await prisma.export.update({ where: { id: exportId }, data: { status: "ready", objectKey: key } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    captureExportError(error, {
      projectId,
      jobId: job.id,
      exportId,
      exportType: type,
      stage: "render_or_upload",
    });
    await prisma.export.update({ where: { id: exportId }, data: { status: "failed", error: message } });
    throw error;
  }
}

export async function createPptx(presentation: ReturnType<typeof presentationSchema.parse>) {
  const document = exportCanvasDocument(presentation);
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

  for (const item of document.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: theme.pptx.background };
    if (item.canvas) {
      await renderCanvasSlide(pptx, slide, item.canvas, theme);
      renderPptxPlaceholders(pptx, slide, item, theme);
      slide.addNotes(item.speakerNotes);
      continue;
    }

    const imageData = await readSlideImageData(item);

    if (imageData && (item.slideKind === "title" || item.slideKind === "section")) {
      await addFittedImage(slide, imageData, { x: 0, y: 0, w: WIDE_LAYOUT.width, h: WIDE_LAYOUT.height }, {
        fit: "cover",
        altText: item.visual.image?.alt,
      });
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
      await renderContentSlide(pptx, slide, item, imageData, theme);
    }

    renderPptxAttribution(slide, item, theme);
    renderPptxPlaceholders(pptx, slide, item, theme);
    slide.addNotes(item.speakerNotes);
  }

  return pptx.write({ outputType: "nodebuffer" }) as Promise<Buffer>;
}

function renderPptxAttribution(
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  const attribution = formatSlideAttribution(item.sourceRefs, item.visual.image);
  if (!attribution) return;
  slide.addText(attribution, {
    x: 0.75,
    y: 7.12,
    w: 11.82,
    h: 0.18,
    fontFace: theme.fonts.body,
    fontSize: 7.5,
    color: theme.pptx.muted,
    fit: "shrink",
    margin: 0,
  });
}

function renderPptxPlaceholders(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  const unresolved = item.placeholders.filter((placeholder) => !placeholder.resolved).slice(0, 3);
  if (!unresolved.length) return;
  const height = Math.min(1.15, 0.34 + unresolved.length * 0.22);
  const y = WIDE_LAYOUT.height - height - 0.18;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.42,
    y,
    w: WIDE_LAYOUT.width - 0.84,
    h: height,
    rectRadius: 0.08,
    fill: { color: "FFF0EC", transparency: 2 },
    line: { color: "A73822", transparency: 4, width: 1 },
  });
  slide.addText(unresolved.map((placeholder) => ({
    text: `Нужно заполнить: ${placeholder.label}`,
    options: { breakLine: true, bullet: { type: "bullet" } },
  })), {
    x: 0.68,
    y: y + 0.08,
    w: WIDE_LAYOUT.width - 1.36,
    h: height - 0.16,
    fontFace: theme.fonts.body,
    fontSize: 9.5,
    color: "7A2416",
    bold: true,
    margin: 0.02,
    fit: "shrink",
    valign: "mid",
  });
}

async function renderContentSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  imageData: string | null,
  theme: ExportTheme,
) {
  const layout = item.layout;

  if (imageData && layout !== "image-focus") {
    await renderDefaultContentSlide(slide, item, imageData, theme);
    return;
  }

  if (layout === "statement") return renderStatementSlide(slide, item, theme);
  if (layout === "quote") return renderQuoteSlide(slide, item, theme);
  if (layout === "definition") return renderDefinitionSlide(pptx, slide, item, theme);
  if (layout === "timeline" || layout === "process") return renderSequenceSlide(pptx, slide, item, theme);
  if (layout === "comparison" || layout === "two-column") return renderComparisonSlide(pptx, slide, item, theme);
  if (layout === "image-focus" && imageData) {
    await renderImageFocusSlide(slide, item, imageData, theme);
    return;
  }
  if (layout === "case-study") return renderThreePanelSlide(pptx, slide, item, ["Ситуация", "Действие", "Результат"], theme);
  if (layout === "question-answer") return renderQuestionAnswerSlide(pptx, slide, item, theme);
  if (layout === "myth-fact") return renderMythFactSlide(pptx, slide, item, theme);
  if (layout === "metrics") return renderMetricsSlide(pptx, slide, item, theme);
  if (layout === "evidence") return renderEvidenceSlide(pptx, slide, item, theme);
  if (layout === "problem-solution") return renderProblemSolutionSlide(pptx, slide, item, theme);
  if (layout === "explain-example") return renderExplainExampleSlide(pptx, slide, item, theme);
  await renderDefaultContentSlide(slide, item, imageData, theme);
}

async function renderCanvasSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  canvas: SlideCanvas,
  theme: ExportTheme,
) {
  slide.background = { color: pptxColor(canvas.background || theme.colors.background) };
  if (canvas.backgroundStyle?.type === "gradient") {
    await addFittedImage(slide, await canvasBackgroundPngData(canvas), { x: 0, y: 0, w: WIDE_LAYOUT.width, h: WIDE_LAYOUT.height }, { fit: "cover" });
  }
  for (const element of sortCanvasElements(canvas.elements)) {
    if (element.opacity <= 0) continue;
    if (element.type === "text") {
      renderCanvasText(slide, element, theme);
      continue;
    }
    if (element.type === "shape") {
      renderCanvasShape(pptx, slide, element);
      continue;
    }
    if (element.type === "image") {
      await renderCanvasImage(slide, element);
    }
  }
}

function renderCanvasText(slide: any, element: CanvasTextElement, theme: ExportTheme) {
  const runs = element.runs.length
    ? element.runs.map((run) => ({
        text: run.text,
        options: {
          bold: run.bold ?? element.bold,
          italic: run.italic ?? element.italic,
          underline: run.underline ?? element.underline,
          color: pptxColor(run.color || element.color),
        },
      }))
    : element.text;

  slide.addText(runs, {
    ...canvasBox(element),
    fontFace: element.fontFamily || theme.fonts.body,
    // Canvas typography is expressed in CSS pixels, while PPTX uses points.
    // 1 CSS px = 0.75 pt at the canvas' 96 DPI coordinate system.
    fontSize: pixelsToPoints(element.fontSize),
    bold: element.bold,
    italic: element.italic,
    underline: element.underline,
    color: pptxColor(element.color),
    align: element.align,
    valign: element.valign === "middle" ? "mid" : element.valign,
    rotate: element.rotation,
    // Generated canvases already compact text and bound font size in the
    // shared builder. Letting PptxGenJS shrink again can silently produce
    // 12–16 pt body text, so PPTX receives the semantic canvas size verbatim.
    fit: "none",
    lineSpacingMultiple: canvasTextLineHeight(element),
    margin: 0,
  });
}

function renderCanvasShape(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  element: CanvasShapeElement,
) {
  const shapeType =
    element.shape === "ellipse"
      ? pptx.ShapeType.ellipse
      : element.shape === "line"
        ? pptx.ShapeType.line
        : element.shape === "roundRect"
          ? pptx.ShapeType.roundRect
          : pptx.ShapeType.rect;

  const options: Record<string, unknown> = {
    ...canvasBox(element),
    rotate: element.rotation,
    line: {
      color: pptxColor(element.stroke),
      width: pixelsToPoints(element.strokeWidth),
      transparency: opacityToTransparency(element.opacity),
    },
  };
  if (element.shape !== "line") {
    options.fill = { color: pptxColor(element.fill), transparency: opacityToTransparency(element.opacity) };
  }
  slide.addShape(shapeType, options);
}

async function renderCanvasImage(slide: any, element: CanvasImageElement) {
  const data = await imageDataForCanvasElement(element);
  if (!data) return;
  const box = canvasBox(element);
  await addFittedImage(slide, data, box, {
    fit: element.fit,
    rotate: element.rotation,
    transparency: opacityToTransparency(element.opacity),
    altText: element.alt,
  });
}

async function addFittedImage(
  slide: any,
  data: string,
  box: { x: number; y: number; w: number; h: number },
  options: {
    fit: CanvasImageElement["fit"];
    rotate?: number;
    transparency?: number;
    altText?: string;
  },
) {
  const fitted = await fitPptxImage(data, box, options.fit);
  slide.addImage({
    ...fitted,
    rotate: options.rotate,
    transparency: options.transparency,
    altText: options.altText || "",
  });
}

export async function fitPptxImage(
  data: string,
  box: { x: number; y: number; w: number; h: number },
  fit: CanvasImageElement["fit"],
) {
  try {
    const commaIndex = data.indexOf(",");
    if (commaIndex < 0) return { data, ...box };
    const source = Buffer.from(data.slice(commaIndex + 1), "base64");
    const metadata = await sharp(source).metadata();
    if (!metadata.width || !metadata.height) return { data, ...box };

    if (fit === "cover") {
      const width = Math.max(1, Math.round(box.w * 96));
      const height = Math.max(1, Math.round(box.h * 96));
      const fitted = await sharp(source)
        .resize(width, height, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
      return { data: `data:image/png;base64,${fitted.toString("base64")}`, ...box };
    }

    const scale = Math.min(box.w / metadata.width, box.h / metadata.height);
    const width = metadata.width * scale;
    const height = metadata.height * scale;
    return {
      data,
      x: box.x + (box.w - width) / 2,
      y: box.y + (box.h - height) / 2,
      w: width,
      h: height,
    };
  } catch (error) {
    logger.warn({ ...errorLogFields(error) }, "could not fit PPTX image; using the original image box");
    return { data, ...box };
  }
}

async function imageDataForCanvasElement(element: CanvasImageElement) {
  if (!element.objectKey) return null;
  try {
    const buffer = await readObjectBuffer(element.objectKey);
    const contentType = element.contentType || contentTypeFromObjectKey(element.objectKey);
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    logger.warn({ objectKey: element.objectKey, ...errorLogFields(error) }, "could not read canvas image");
    return null;
  }
}

function canvasBox(element: Pick<CanvasElement, "x" | "y" | "w" | "h">) {
  return {
    x: element.x / 96,
    y: element.y / 96,
    w: element.w / 96,
    h: element.h / 96,
  };
}

function pixelsToPoints(pixels: number) {
  return Math.round(pixels * 75) / 100;
}

function opacityToTransparency(opacity: number) {
  return Math.max(0, Math.min(100, Math.round((1 - opacity) * 100)));
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
  const detailedItems = item.visual.items.filter((entry) => entry.label || entry.text).slice(0, 5);
  const items = detailedItems.length
    ? detailedItems
    : sequenceItems(item).slice(0, 5).map((text, index) => ({ label: `Шаг ${index + 1}`, text }));
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
    slide.addText(text.label, {
      x: x + 0.18,
      y: 2.88,
      w: width - 0.52,
      h: 0.48,
      fontFace: theme.fonts.heading,
      fontSize: 15,
      bold: true,
      color: theme.pptx.text,
      fit: "shrink",
    });
    slide.addText(text.text || text.label, {
      x: x + 0.18,
      y: 3.45,
      w: width - 0.52,
      h: 0.72,
      fontFace: theme.fonts.body,
      fontSize: 12,
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
  slide.addText("Критерий", { x: 0.9, y: 1.7, w: 2.1, h: 0.42, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  slide.addText(leftLabel, { x: 3.15, y: 1.7, w: 4.35, h: 0.42, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  slide.addText(rightLabel, { x: 7.65, y: 1.7, w: 4.8, h: 0.42, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  rows.forEach((row, index) => {
    const y = 2.18 + index * 1.22;
    for (const [x, width, text, bold] of [
      [0.9, 2.1, row.label || `Критерий ${index + 1}`, true],
      [3.15, 4.35, row.left || row.label, false],
      [7.65, 4.8, row.right || row.label, false],
    ] as const) {
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: width, h: 0.96, fill: { color: bold ? theme.pptx.surfaceAlt : theme.pptx.surface }, line: { color: theme.pptx.line } });
      slide.addText(text, { x: x + 0.16, y: y + 0.16, w: width - 0.32, h: 0.56, fontFace: bold ? theme.fonts.heading : theme.fonts.body, fontSize: 13, bold, color: bold ? theme.pptx.text : theme.pptx.muted, fit: "shrink" });
    }
  });
}

async function renderImageFocusSlide(slide: any, item: ReturnType<typeof presentationSchema.parse>["slides"][number], imageData: string, theme: ExportTheme) {
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
  await addFittedImage(slide, imageData, { x: 6.65, y: 0.72, w: 5.95, h: 5.75 }, {
    fit: "contain",
    altText: item.visual.image?.alt,
  });
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
  item.bullets.slice(0, 3).forEach((text, index) => {
    const x = 1.55 + index * 3.45;
    slide.addText(["Почему", "Пример", "Что это меняет"][index], { x, y: 4.72, w: 3.05, h: 0.28, fontFace: theme.fonts.heading, fontSize: 11, bold: true, color: theme.pptx.text });
    slide.addText(text, { x, y: 5.1, w: 3.05, h: 0.7, fontFace: theme.fonts.body, fontSize: 12, color: theme.pptx.muted, fit: "shrink" });
  });
}

function renderMythFactSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme);
  const visualItems = item.visual.items.slice(0, 2);
  const fallback = sequenceItems(item);
  ["Миф", "Факт"].forEach((label, index) => {
    const x = 0.92 + index * 5.78;
    const entry = visualItems[index];
    const text = entry ? [entry.label, entry.text].filter(Boolean).join(". ") : fallback[index] || item.thesis;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 1.85, w: 5.55, h: 2.0, fill: { color: index ? theme.pptx.surface : theme.pptx.surfaceAlt }, line: { color: theme.pptx.line } });
    slide.addText(label, { x: x + 0.22, y: 2.08, w: 5.1, h: 0.3, fontFace: theme.fonts.heading, fontSize: 12, bold: true, color: theme.pptx.text });
    slide.addText(text, { x: x + 0.22, y: 2.58, w: 5.1, h: 0.82, fontFace: theme.fonts.body, fontSize: 15, color: theme.pptx.muted, fit: "shrink" });
    if (item.bullets[index]) {
      slide.addText(index ? "Проверка" : "Почему в это верят", { x, y: 4.35, w: 5.55, h: 0.28, fontFace: theme.fonts.heading, fontSize: 11, bold: true, color: theme.pptx.text });
      slide.addText(item.bullets[index], { x, y: 4.78, w: 5.55, h: 0.72, fontFace: theme.fonts.body, fontSize: 12, color: theme.pptx.muted, fit: "shrink" });
    }
  });
}

function renderMetricsSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  const items = sequenceItems(item).filter(hasMeasurableValue).slice(0, 4);
  if (!items.length) return renderStatementSlide(slide, item, theme);
  renderSlideTitle(slide, item.title, theme);
  items.forEach((text, index) => {
    const x = 0.9 + index * 3;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.0, w: 2.72, h: 2.35, fill: { color: theme.pptx.surface }, line: { color: theme.pptx.line } });
    slide.addText(metricLead(text), { x: x + 0.18, y: 2.28, w: 2.36, h: 0.46, fontFace: theme.fonts.heading, fontSize: 22, bold: true, color: theme.pptx.accentAlt, fit: "shrink" });
    slide.addText(text, { x: x + 0.18, y: 3.08, w: 2.36, h: 0.78, fontFace: theme.fonts.body, fontSize: 12, color: theme.pptx.muted, fit: "shrink" });
  });
}

function renderEvidenceSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme);
  slide.addText(item.thesis || slideBodyText(item), {
    x: 0.9, y: 1.55, w: 11.55, h: 1.0, fontFace: theme.fonts.heading, fontSize: 25, bold: true,
    color: theme.pptx.text, fit: "shrink",
  });
  slide.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.68, w: 11.55, h: 0.04, fill: { color: theme.pptx.accent }, line: { transparency: 100 } });
  sequenceItems(item).slice(0, 4).forEach((text, index) => {
    const x = 0.92 + (index % 2) * 5.85;
    const y = 3.02 + Math.floor(index / 2) * 1.15;
    slide.addShape(pptx.ShapeType.ellipse, { x, y: y + 0.06, w: 0.22, h: 0.22, fill: { color: theme.pptx.accentAlt }, line: { transparency: 100 } });
    slide.addText(text, { x: x + 0.38, y, w: 5.25, h: 0.72, fontFace: theme.fonts.body, fontSize: 14, color: theme.pptx.muted, fit: "shrink" });
  });
}

function renderProblemSolutionSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme);
  const items = sequenceItems(item);
  ["Проблема", "Причина", "Решение"].forEach((label, index) => {
    const x = 0.9 + index * 4.05;
    slide.addText(label, { x, y: 1.8, w: 3.55, h: 0.35, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
    slide.addShape(pptx.ShapeType.rect, { x, y: 2.28, w: 3.55, h: 0.04, fill: { color: index === 2 ? theme.pptx.accentAlt : theme.pptx.line }, line: { transparency: 100 } });
    slide.addText(items[index] || item.thesis || slideBodyText(item), { x, y: 2.65, w: 3.55, h: 2.2, fontFace: theme.fonts.body, fontSize: 16, color: theme.pptx.muted, fit: "shrink" });
    if (index < 2) slide.addText("→", { x: x + 3.63, y: 3.4, w: 0.3, h: 0.3, fontFace: theme.fonts.heading, fontSize: 16, bold: true, color: theme.pptx.muted, align: "center" });
  });
}

function renderExplainExampleSlide(
  pptx: InstanceType<typeof PptxGenConstructor>,
  slide: any,
  item: ReturnType<typeof presentationSchema.parse>["slides"][number],
  theme: ExportTheme,
) {
  renderSlideTitle(slide, item.title, theme);
  const items = sequenceItems(item);
  const definition = item.definition || { term: item.title, text: item.thesis || items[0] || slideBodyText(item) };
  slide.addText(definition.term, { x: 0.9, y: 1.75, w: 4.35, h: 0.75, fontFace: theme.fonts.heading, fontSize: 25, bold: true, color: theme.pptx.text, fit: "shrink" });
  slide.addText(definition.text, { x: 0.9, y: 2.75, w: 4.35, h: 2.15, fontFace: theme.fonts.body, fontSize: 17, color: theme.pptx.muted, fit: "shrink" });
  slide.addShape(pptx.ShapeType.rect, { x: 5.55, y: 1.72, w: 0.03, h: 4.2, fill: { color: theme.pptx.line }, line: { transparency: 100 } });
  slide.addText("Пример", { x: 6.0, y: 1.75, w: 5.3, h: 0.35, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  slide.addText(items[1] || items[0] || item.thesis, { x: 6.0, y: 2.25, w: 5.3, h: 1.35, fontFace: theme.fonts.body, fontSize: 17, bold: true, color: theme.pptx.text, fit: "shrink" });
  slide.addText("Важно помнить", { x: 6.0, y: 4.0, w: 5.3, h: 0.35, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  slide.addText(items[2] || item.bullets[1] || "Пример помогает понять идею, но не заменяет точное определение.", { x: 6.0, y: 4.5, w: 5.3, h: 1.05, fontFace: theme.fonts.body, fontSize: 14, color: theme.pptx.muted, fit: "shrink" });
}

async function renderDefaultContentSlide(slide: any, item: ReturnType<typeof presentationSchema.parse>["slides"][number], imageData: string | null, theme: ExportTheme) {
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
    await addFittedImage(slide, imageData, { x: 6.72, y: 0.68, w: 5.9, h: 5.85 }, {
      fit: "contain",
      altText: item.visual.image?.alt,
    });
  }
}

export async function createPdf(presentation: ReturnType<typeof presentationSchema.parse>) {
  const html = await renderPdfHtml(exportCanvasDocument(presentation));
  return renderHtmlToPdf(html, { viewportWidth: 1280, viewportHeight: 720, pageWidth: "1280px", pageHeight: "720px" });
}

function exportCanvasDocument(presentation: ReturnType<typeof presentationSchema.parse>) {
  // Export jobs always arrive here after preflight. This compatibility branch
  // preserves the old template renderer for genuinely legacy, no-canvas
  // presentations while keeping visual-director documents on their canvas
  // source of truth for direct library callers and existing integrations.
  if (presentation.slides.some((slide) => slide.canvas)) return ensureEditableCanvas(presentation);
  return presentation.designBrief ? ensureEditableCanvas(presentation) : presentation;
}

export async function renderPdfHtml(presentation: ReturnType<typeof presentationSchema.parse>) {
  const theme = exportTheme(presentation);
  const slides = await Promise.all(
    presentation.slides.map(async (slide) => {
      if (slide.canvas) {
        const elements = await Promise.all(sortCanvasElements(slide.canvas.elements).map((element) => renderPdfElement(element)));
        return `<section class="slide canvas-slide" style="background:${escapeHtml(canvasBackgroundCss(slide.canvas.backgroundStyle, slide.canvas.background))}">${elements.join("")}${pdfPlaceholderWarnings(slide)}</section>`;
      }
      return renderPdfTemplateSlide(slide, theme);
    }),
  );

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: 1280px 720px; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #000; font-family: Arial, "Noto Sans", "DejaVu Sans", sans-serif; }
  .slide { position: relative; width: 1280px; height: 720px; overflow: hidden; page-break-after: always; }
  .slide:last-child { page-break-after: auto; }
  .template-slide { display: grid; place-items: center; padding: 54px; color: var(--slide-text); font-family: var(--slide-body-font); }
  .template-slide::before { content: ""; position: absolute; inset: 0; pointer-events: none; }
  .template-slide[data-bg="title"]::before { background: linear-gradient(90deg, color-mix(in srgb, var(--slide-accent) 18%, transparent) 0 32%, transparent 32% 82%, color-mix(in srgb, var(--slide-accent-alt) 12%, transparent) 82%); }
  .template-slide[data-bg="section"]::before { background: linear-gradient(135deg, transparent 0 46%, color-mix(in srgb, var(--slide-accent) 14%, transparent) 46% 54%, transparent 54%), linear-gradient(90deg, color-mix(in srgb, var(--slide-surface-alt) 58%, transparent) 0 18%, transparent 18%); }
  .template-slide[data-bg="summary"]::before { background: linear-gradient(180deg, transparent 0 76%, color-mix(in srgb, var(--slide-surface-alt) 70%, transparent) 76%); }
  .template-slide[data-bg="v1"]::before { background: linear-gradient(90deg, transparent 0 62%, color-mix(in srgb, var(--slide-surface-alt) 68%, transparent) 62%); }
  .template-slide[data-bg="v4"]::before { background: linear-gradient(105deg, color-mix(in srgb, var(--slide-surface-alt) 78%, transparent) 0 28%, transparent 28% 72%, color-mix(in srgb, var(--slide-accent-alt) 12%, transparent) 72%); }
  .template-content { position: relative; z-index: 1; width: 100%; max-width: 930px; display: grid; gap: 20px; }
  .template-title-content { align-content: center; justify-items: center; min-height: 612px; }
  .template-title-content .template-chips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: min(100%, 560px); }
  .template-title-content .template-chips span { width: 100%; max-width: none; text-align: center; }
  .template-title-content .template-chips span:only-child,
  .template-title-content .template-chips span:nth-child(3):last-child { grid-column: 1 / -1; }
  .template-title { width: fit-content; max-width: 100%; margin: 0; border-radius: 8px; padding: 10px 14px; background: color-mix(in srgb, var(--slide-surface) 92%, transparent); color: var(--slide-text); font-family: var(--slide-heading-font); font-size: 42px; line-height: 1.05; text-align: left; }
  .template-title.center { text-align: center; font-size: 58px; }
  .template-body { width: fit-content; max-width: 100%; margin: 0; border-radius: 8px; padding: 10px 14px; background: color-mix(in srgb, var(--slide-surface) 92%, transparent); color: var(--slide-muted); font-size: 25px; line-height: 1.35; }
  .template-body.center { text-align: center; max-width: 860px; margin: 0 auto; }
  .template-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(330px, 0.9fr); gap: 24px; align-items: center; width: 100%; max-width: 1080px; }
  .template-grid.reverse { grid-template-columns: minmax(330px, 0.9fr) minmax(0, 1fr); }
  .template-grid.reverse .template-copy { order: 2; }
  .template-grid.reverse .template-image { order: 1; }
  .template-image { margin: 0; overflow: hidden; border-radius: 8px; background: var(--slide-surface); }
  .template-image img { display: block; width: 100%; max-height: 430px; object-fit: contain; }
  .template-image figcaption { padding: 7px 9px; color: var(--slide-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .template-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .template-card { border: 1px solid var(--slide-line); border-radius: 8px; padding: 16px; background: var(--slide-surface); color: var(--slide-muted); font-size: 18px; line-height: 1.35; }
  .template-card strong, .template-label { display: block; color: var(--slide-text); font-family: var(--slide-heading-font); margin-bottom: 8px; }
  .template-list { margin: 0; padding-left: 24px; color: var(--slide-muted); font-size: 22px; line-height: 1.38; }
  .template-list li { margin-bottom: 10px; }
  .template-chips { display: flex; flex-wrap: wrap; gap: 9px; }
  .template-chips span { max-width: 280px; border-radius: 8px; padding: 8px 12px; background: color-mix(in srgb, var(--slide-accent) 14%, var(--slide-surface)); color: var(--slide-text); font-size: 14px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
  .template-quote { margin: 0; color: var(--slide-text); font-family: var(--slide-heading-font); font-size: 42px; line-height: 1.1; font-weight: 800; text-align: center; }
  .template-definition { border: 1px solid var(--slide-line); border-radius: 8px; padding: 28px; background: var(--slide-surface-alt); }
  .template-definition strong { display: block; color: var(--slide-text); font-family: var(--slide-heading-font); font-size: 36px; margin-bottom: 12px; }
  .template-comparison { display: grid; grid-template-columns: minmax(150px, .6fr) repeat(2, minmax(0, 1fr)); gap: 10px; }
  .template-comparison > strong { border-radius: 8px; padding: 12px; background: var(--slide-text); color: var(--slide-bg); }
  .template-comparison .criterion { background: var(--slide-surface-alt); color: var(--slide-text); font-weight: 800; }
  .template-support { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .template-support section { border-top: 2px solid var(--slide-line); padding-top: 12px; }
  .template-support strong { display: block; margin-bottom: 8px; color: var(--slide-text); font-family: var(--slide-heading-font); }
  .template-support p { margin: 0; color: var(--slide-muted); font-size: 16px; line-height: 1.35; }
  .template-summary-story { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(300px, .8fr); gap: 68px; align-items: center; min-height: 360px; }
  .template-summary-conclusion { margin: 0; border-bottom: 5px solid var(--slide-accent); padding: 4px 0 24px; color: var(--slide-text); font-family: var(--slide-heading-font); font-size: 48px; line-height: 1.08; font-weight: 800; }
  .template-summary-support { display: grid; gap: 14px; }
  .template-summary-support > strong { color: var(--slide-text); font-family: var(--slide-heading-font); font-size: 24px; }
  .template-summary-support p { position: relative; margin: 0; padding-left: 24px; color: var(--slide-muted); font-size: 24px; line-height: 1.28; }
  .template-summary-support p::before { content: ""; position: absolute; left: 0; top: .5em; width: 10px; height: 10px; border-radius: 50%; background: var(--slide-accent-alt); }
  .template-summary-final { display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 18px; align-items: center; margin: 0; border-top: 1px solid var(--slide-line); padding: 18px 22px; background: color-mix(in srgb, var(--slide-surface-alt) 72%, transparent); color: var(--slide-muted); font-size: 24px; line-height: 1.3; }
  .template-summary-final strong { color: var(--slide-text); font-family: var(--slide-heading-font); font-size: 24px; }
  .template-metric strong { color: var(--slide-accent-alt); font-size: 36px; }
  .template-evidence-thesis { margin: 0; border-bottom: 3px solid var(--slide-accent); padding-bottom: 16px; color: var(--slide-text); font-family: var(--slide-heading-font); font-size: 32px; line-height: 1.15; font-weight: 800; }
  .template-evidence-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 28px; }
  .template-evidence-item { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 10px; color: var(--slide-muted); font-size: 17px; line-height: 1.35; }
  .template-evidence-item::before { content: ""; width: 10px; height: 10px; margin-top: 6px; border-radius: 50%; background: var(--slide-accent-alt); }
  .template-sources { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; border-top: 1px solid var(--slide-line); padding-top: 10px; color: var(--slide-muted); font-size: 10px; line-height: 1.3; }
  .template-flow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; }
  .template-flow section { position: relative; border-top: 3px solid var(--slide-line); padding-top: 16px; }
  .template-flow section:last-child { border-color: var(--slide-accent-alt); }
  .template-flow section:not(:last-child)::after { content: "→"; position: absolute; right: -22px; top: 48%; color: var(--slide-muted); font-size: 20px; font-weight: 800; }
  .template-flow strong, .template-explain strong { display: block; margin-bottom: 14px; color: var(--slide-text); font-family: var(--slide-heading-font); }
  .template-flow p, .template-explain p { margin: 0; color: var(--slide-muted); font-size: 17px; line-height: 1.4; }
  .template-explain { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); gap: 30px; }
  .template-explain > section { border-right: 2px solid var(--slide-line); padding-right: 26px; }
  .template-explain > section > strong { font-size: 30px; }
  .template-explain-notes { display: grid; gap: 24px; }
  .template-explain-notes section { border-bottom: 1px solid var(--slide-line); padding-bottom: 16px; }
  .element { position: absolute; transform-origin: center; overflow: hidden; }
  .text { white-space: pre-wrap; overflow: hidden; }
  .image { width: 100%; height: 100%; display: block; border-radius: 18px; }
  .shape { width: 100%; height: 100%; }
  .template-attribution { position: absolute; z-index: 15; left: 72px; right: 72px; bottom: 16px; margin: 0; color: var(--slide-muted); font-size: 10px; line-height: 1.1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .placeholder-warning { position: absolute; z-index: 20; left: 42px; right: 42px; bottom: 18px; display: grid; gap: 5px; margin: 0; border: 2px solid #a73822; border-radius: 12px; padding: 10px 16px; background: rgba(255, 240, 236, .97); color: #7a2416; font-size: 15px; line-height: 1.25; font-weight: 800; }
  .placeholder-warning span { display: block; overflow-wrap: anywhere; }
</style>
</head>
<body>${slides.join("")}</body>
</html>`;
}

async function renderPdfTemplateSlide(slide: ReturnType<typeof presentationSchema.parse>["slides"][number], theme: ExportTheme) {
  const image = await pdfSlideImageFigure(slide);
  const vars = pdfThemeVars(theme);
  const bg = slideBackgroundVariant(slide);
  const content = await pdfTemplateContent(slide, image);
  const attribution = formatSlideAttribution(slide.sourceRefs, slide.visual.image);
  const footer = attribution ? `<p class="template-attribution">${escapeHtml(attribution)}</p>` : "";
  return `<section class="slide template-slide" data-bg="${escapeHtml(bg)}" style="${vars}">${content}${footer}${pdfPlaceholderWarnings(slide)}</section>`;
}

function pdfPlaceholderWarnings(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const unresolved = slide.placeholders.filter((placeholder) => !placeholder.resolved).slice(0, 3);
  if (!unresolved.length) return "";
  return `<div class="placeholder-warning" role="note">${unresolved
    .map((placeholder) => `<span>Нужно заполнить: ${escapeHtml(placeholder.label)}</span>`)
    .join("")}</div>`;
}

async function pdfTemplateContent(slide: ReturnType<typeof presentationSchema.parse>["slides"][number], imageFigure: string) {
  if (slide.slideKind === "title" || slide.slideKind === "section") {
    const imageStyle = slide.visual.image?.url ? ` style="background-image:linear-gradient(color-mix(in srgb, var(--slide-bg) 90%, transparent), color-mix(in srgb, var(--slide-bg) 94%, transparent)),url('${escapeHtml(slide.visual.image.url)}');background-position:center;background-size:contain;background-repeat:no-repeat;border-radius:8px;padding:56px"` : "";
    return `<div class="template-content template-title-content"${imageStyle}><h1 class="template-title center">${escapeHtml(slide.title)}</h1>${paragraph(slide.thesis || slideBodyText(slide), "template-body center")}${chips(slide.bullets.slice(0, 3))}</div>`;
  }

  const body = pdfLayoutBody(slide);
  if (slide.slideKind === "summary") return `<div class="template-content">${body}</div>`;
  if (imageFigure && slide.layout !== "image-focus") {
    const reverse = slide.order % 2 === 0 ? " reverse" : "";
    return `<div class="template-grid${reverse}"><div class="template-copy template-content">${body}</div>${imageFigure}</div>`;
  }
  if (slide.layout === "image-focus" && imageFigure) {
    return `<div class="template-grid"><div class="template-copy template-content">${title(slide)}${paragraph(slide.thesis || slideBodyText(slide), "template-body")}${chips(slide.bullets.slice(0, 3))}</div>${imageFigure}</div>`;
  }
  return `<div class="template-content">${body}</div>`;
}

function pdfLayoutBody(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  if (slide.slideKind === "summary") return summary(slide);
  if (slide.layout === "statement") return `${title(slide, "center")}${paragraph(slide.thesis || slideBodyText(slide), "template-quote")}${chips(slide.bullets.slice(0, 3))}`;
  if (slide.layout === "quote") return `${title(slide)}<blockquote class="template-quote">${escapeHtml(quoteText(slide))}</blockquote>${paragraph(slide.bullets[0] || "", "template-body center")}`;
  if (slide.layout === "definition") {
    const definition = slide.definition || { term: slide.title, text: slide.thesis || slideBodyText(slide) };
    return `${title(slide)}<div class="template-definition"><strong>${escapeHtml(definition.term)}</strong>${paragraph(definition.text, "template-body")}</div>${chips(slide.bullets.slice(0, 3))}`;
  }
  if (slide.layout === "timeline" || slide.layout === "process") return `${title(slide)}${paragraph(slide.thesis, "template-body")}${sequence(slide)}`;
  if (slide.layout === "comparison" || slide.layout === "two-column") return `${title(slide)}${comparison(slide)}`;
  if (slide.layout === "case-study") return `${title(slide)}${cards(sequenceItems(slide).slice(0, 3), "case", ["Ситуация", "Действие", "Результат"])}`;
  if (slide.layout === "question-answer") return `${title(slide, "center")}<div class="template-definition"><strong>Ответ</strong>${paragraph(slide.thesis || slideBodyText(slide), "template-body")}</div>${support(slide.bullets.slice(0, 3), ["Почему", "Пример", "Что это меняет"])}`;
  if (slide.layout === "myth-fact") return mythFact(slide);
  if (slide.layout === "metrics") {
    const items = sequenceItems(slide).filter(hasMeasurableValue).slice(0, 4);
    return items.length ? `${title(slide)}${cards(items, "metric")}` : `${title(slide, "center")}${paragraph(slide.thesis || slideBodyText(slide), "template-quote")}`;
  }
  if (slide.layout === "evidence") return evidence(slide);
  if (slide.layout === "problem-solution") return problemSolution(slide);
  if (slide.layout === "explain-example") return explainExample(slide);
  return `${title(slide)}${paragraph(slide.thesis, "template-body")}${bullets(slide.bullets.length ? slide.bullets : sequenceItems(slide).slice(0, 5))}`;
}

function summary(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const items = sequenceItems(slide).slice(0, 5);
  const mainConclusion = slide.thesis || items[0] || slideBodyText(slide);
  const supportingItems = items.filter((item) => item !== mainConclusion).slice(0, 3);
  const finalThought = items.filter((item) => item !== mainConclusion).slice(3, 4)[0];
  const support = supportingItems.length
    ? `<section class="template-summary-support"><strong>Ключевые мысли</strong>${supportingItems.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</section>`
    : "";
  const footer = finalThought
    ? `<p class="template-summary-final"><strong>Что стоит запомнить</strong><span>${escapeHtml(finalThought)}</span></p>`
    : "";
  return `${title(slide)}<div class="template-summary-story"><p class="template-summary-conclusion">${escapeHtml(mainConclusion)}</p>${support}</div>${footer}`;
}

function title(slide: ReturnType<typeof presentationSchema.parse>["slides"][number], align = "") {
  return `<h2 class="template-title${align ? ` ${align}` : ""}">${escapeHtml(slide.title)}</h2>`;
}

function paragraph(value: string, className: string) {
  return value ? `<p class="${className}">${escapeHtml(value)}</p>` : "";
}

function bullets(items: string[]) {
  return items.length ? `<ul class="template-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
}

function chips(items: string[]) {
  return items.length ? `<div class="template-chips">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : "";
}

function cards(items: string[], type: string, labels: string[] = []) {
  return items.length
    ? `<div class="template-cards">${items.map((item, index) => `<div class="template-card template-${type}"><strong>${escapeHtml(labels[index] || (type === "metric" ? metricLead(item) : String(index + 1)))}</strong>${escapeHtml(item)}</div>`).join("")}</div>`
    : "";
}

function evidence(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const items = sequenceItems(slide).slice(0, 4);
  return `${title(slide)}<p class="template-evidence-thesis">${escapeHtml(slide.thesis || slideBodyText(slide))}</p><div class="template-evidence-list">${items.map((item) => `<div class="template-evidence-item">${escapeHtml(item)}</div>`).join("")}</div>`;
}

function problemSolution(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const items = sequenceItems(slide);
  return `${title(slide)}<div class="template-flow">${["Проблема", "Причина", "Решение"].map((label, index) => `<section><strong>${label}</strong><p>${escapeHtml(items[index] || slide.thesis || slideBodyText(slide))}</p></section>`).join("")}</div>`;
}

function explainExample(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const items = sequenceItems(slide);
  const definition = slide.definition || { term: slide.title, text: slide.thesis || items[0] || slideBodyText(slide) };
  return `${title(slide)}<div class="template-explain"><section><strong>${escapeHtml(definition.term)}</strong><p>${escapeHtml(definition.text)}</p></section><div class="template-explain-notes"><section><strong>Пример</strong><p>${escapeHtml(items[1] || items[0] || slide.thesis)}</p></section><section><strong>Важно помнить</strong><p>${escapeHtml(items[2] || slide.bullets[1] || "Пример помогает понять идею, но не заменяет точное определение.")}</p></section></div></div>`;
}

function comparison(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const rows = comparisonRows(slide).slice(0, 4);
  return `<div class="template-comparison"><strong class="criterion">Критерий</strong><strong>${escapeHtml(slide.visual.leftLabel || "Первое")}</strong><strong>${escapeHtml(slide.visual.rightLabel || "Второе")}</strong>${rows.map((row, index) => `<div class="template-card criterion">${escapeHtml(row.label || `Критерий ${index + 1}`)}</div><div class="template-card">${escapeHtml(row.left || row.label)}</div><div class="template-card">${escapeHtml(row.right || row.label)}</div>`).join("")}</div>`;
}

function sequence(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const detailed = slide.visual.items.filter((item) => item.label || item.text).slice(0, 5);
  const items = detailed.length ? detailed : sequenceItems(slide).slice(0, 5).map((text, index) => ({ label: `Шаг ${index + 1}`, text }));
  return `<div class="template-cards">${items.map((item) => `<div class="template-card"><strong>${escapeHtml(item.label)}</strong>${escapeHtml(item.text || item.label)}</div>`).join("")}</div>`;
}

function support(items: string[], labels: string[]) {
  if (!items.length) return "";
  return `<div class="template-support">${items.map((item, index) => `<section><strong>${escapeHtml(labels[index] || `Пункт ${index + 1}`)}</strong><p>${escapeHtml(item)}</p></section>`).join("")}</div>`;
}

function mythFact(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const detailed = slide.visual.items.slice(0, 2);
  const fallback = sequenceItems(slide);
  const items = [0, 1].map((index) => {
    const item = detailed[index];
    return item ? [item.label, item.text].filter(Boolean).join(". ") : fallback[index] || slide.thesis;
  });
  return `${title(slide)}${cards(items, "myth", ["Миф", "Факт"])}${support(slide.bullets.slice(0, 2), ["Почему в это верят", "Проверка"])}`;
}

async function pdfSlideImageFigure(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const image = slide.visual.image;
  if (!image) return "";
  const src = await pdfSlideImageSrc(slide);
  if (!src) return "";
  return `<figure class="template-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(image.alt || "")}" /></figure>`;
}

async function pdfSlideImageSrc(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const image = slide.visual.image;
  if (!image) return "";
  if (!image.objectKey) return image.url;
  try {
    const buffer = await readObjectBuffer(image.objectKey);
    const contentType = image.contentType || contentTypeFromObjectKey(image.objectKey);
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    logger.warn({ objectKey: image.objectKey, ...errorLogFields(error) }, "could not read pdf slide image");
    return image.url;
  }
}

function pdfThemeVars(theme: ExportTheme) {
  return [
    `--slide-bg:${theme.colors.background}`,
    `--slide-surface:${theme.colors.surface}`,
    `--slide-surface-alt:${theme.colors.surfaceAlt}`,
    `--slide-text:${theme.colors.text}`,
    `--slide-muted:${theme.colors.muted}`,
    `--slide-accent:${theme.colors.accent}`,
    `--slide-accent-alt:${theme.colors.accentAlt}`,
    `--slide-line:${theme.colors.line}`,
    `--slide-heading-font:${cssString(theme.fonts.heading)}, Georgia, Arial, sans-serif`,
    `--slide-body-font:${cssString(theme.fonts.body)}, Arial, sans-serif`,
    `background:${theme.colors.background}`,
  ].join(";");
}

async function renderPdfElement(element: CanvasElement) {
  const style = [
    `left:${element.x}px`,
    `top:${element.y}px`,
    `width:${element.w}px`,
    `height:${element.h}px`,
    `z-index:${element.zIndex}`,
    `opacity:${element.opacity}`,
    `transform:rotate(${element.rotation}deg)`,
  ].join(";");

  if (element.type === "text") {
    return `<div class="element text" data-canvas-element="${escapeHtml(element.id)}" style="${style};${pdfTextStyle(element)}">${renderPdfText(element)}</div>`;
  }

  if (element.type === "shape") {
    return `<div class="element" data-canvas-element="${escapeHtml(element.id)}" style="${style}"><div class="shape" style="${pdfShapeStyle(element)}"></div></div>`;
  }

  const src = await pdfImageSrc(element);
  return src ? `<div class="element" data-canvas-element="${escapeHtml(element.id)}" style="${style};overflow:hidden"><img class="image" src="${escapeHtml(src)}" alt="${escapeHtml(element.alt)}" style="object-fit:${element.fit}" /></div>` : "";
}

function renderPdfText(element: CanvasTextElement) {
  if (!element.runs.length) return escapeHtml(element.text);
  return element.runs
    .map((run) => {
      const style = [
        (run.bold ?? element.bold) ? "font-weight:800" : "",
        (run.italic ?? element.italic) ? "font-style:italic" : "",
        (run.underline ?? element.underline) ? "text-decoration:underline" : "",
        run.color ? `color:${run.color}` : "",
      ]
        .filter(Boolean)
        .join(";");
      return `<span style="${style}">${escapeHtml(run.text)}</span>`;
    })
    .join("");
}

function pdfTextStyle(element: CanvasTextElement) {
  return [
    `color:${element.color}`,
    `font-family:${cssString(element.fontFamily)}, Arial, "Noto Sans", "DejaVu Sans", sans-serif`,
    `font-size:${element.fontSize}px`,
    `font-weight:${element.bold ? 800 : 400}`,
    `font-style:${element.italic ? "italic" : "normal"}`,
    `text-decoration:${element.underline ? "underline" : "none"}`,
    `text-align:${element.align}`,
    "display:flex",
    "flex-direction:column",
    `justify-content:${element.valign === "middle" ? "center" : element.valign === "bottom" ? "flex-end" : "flex-start"}`,
    `line-height:${canvasTextLineHeight(element)}`,
    "overflow-wrap:anywhere",
    "word-break:normal",
  ].join(";");
}

async function canvasBackgroundPngData(canvas: SlideCanvas) {
  const png = await sharp(Buffer.from(canvasBackgroundSvg(canvas))).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function canvasBackgroundSvg(canvas: SlideCanvas) {
  const style = canvas.backgroundStyle;
  if (!style || style.type === "solid") {
    const color = style?.color || canvas.background;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
  }
  const x1 = 50 - Math.cos((style.angle * Math.PI) / 180) * 50;
  const y1 = 50 - Math.sin((style.angle * Math.PI) / 180) * 50;
  const x2 = 100 - x1;
  const y2 = 100 - y1;
  const stops = style.stops.map((stop) => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}" stop-opacity="${stop.opacity}"/>`).join("");
  const blobs = style.blobs.map((blob, index) => {
    const radius = blob.size * Math.min(canvas.width, canvas.height) * 0.52;
    return `<circle cx="${blob.x * canvas.width}" cy="${blob.y * canvas.height}" r="${radius}" fill="${blob.color}" fill-opacity="${blob.opacity}" filter="url(#blur${index})"/>`;
  }).join("");
  const filters = style.blobs.map((blob, index) => `<filter id="blur${index}" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="${blob.blur}"/></filter>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><defs><linearGradient id="base" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient>${filters}</defs><rect width="100%" height="100%" fill="url(#base)"/>${blobs}</svg>`;
  return svg;
}

function pdfShapeStyle(element: CanvasShapeElement) {
  if (element.shape === "line") {
    return `border-top:${Math.max(1, element.strokeWidth)}px solid ${element.stroke};margin-top:${Math.max(0, element.h / 2)}px`;
  }

  return [
    `background:${element.fill}`,
    `border:${element.strokeWidth}px solid ${element.stroke}`,
    `border-radius:${element.shape === "roundRect" ? "18px" : element.shape === "ellipse" ? "50%" : "0"}`,
  ].join(";");
}

async function pdfImageSrc(element: CanvasImageElement) {
  if (!element.objectKey) return element.url;
  try {
    const buffer = await readObjectBuffer(element.objectKey);
    const contentType = element.contentType || contentTypeFromObjectKey(element.objectKey);
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    logger.warn({ objectKey: element.objectKey, ...errorLogFields(error) }, "could not read pdf image");
    return element.url;
  }
}

function exportTheme(presentation: ReturnType<typeof presentationSchema.parse>): ExportTheme {
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

function definitionText(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  return slide.definition ? `${slide.definition.term}: ${slide.definition.text}` : "";
}

function visualText(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const visual = slide.visual;
  if (!visual || visual.type === "none") return "";
  if (visual.diagram?.fallback) return [visual.diagram.title || visual.title || visual.type, visual.diagram.fallback].filter(Boolean).join(": ");
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
    logger.warn({ objectKey: image.objectKey, ...errorLogFields(error) }, "could not read slide image");
    return null;
  }
}

function contentTypeFromObjectKey(objectKey: string) {
  const lower = objectKey.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
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

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssString(value: string) {
  return `"${String(value || "Arial").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
