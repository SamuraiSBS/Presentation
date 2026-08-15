import type { Job } from "bullmq";
import { createRequire } from "node:module";
import {
  ensureEditableCanvas,
  canvasBackgroundCss,
  exportPdfFontStack,
  formatSlideAttribution,
  hasMeasurableValue,
  metricLead,
  presentationSchema,
  resolvePresentationTheme,
  sortCanvasElements,
  type PresentationTheme,
} from "@studydeck/shared";
import { captureExportError, errorLogFields, logger, type TraceCarrier, withTraceSpan } from "../observability.js";
import { getPrisma } from "../prisma.js";
import { deleteObject, putObjectBuffer, readObjectBuffer } from "../storage.js";
import { recordCostEvent, runWithUsageContext } from "../usage-ledger.js";
import { renderHtmlToPdf } from "./pdf-renderer.js";
import {
  handleComplianceReportExportJob,
  type ComplianceReportExportJobData,
} from "./defense/jobs.js";
import { preparePresentationForExport } from "./export-preflight.js";
import { renderPptxContentSlide } from "./export/pptx-content.js";
import { renderPptxCanvasSlide } from "./export/pptx-canvas.js";
import { addFittedPptxImage } from "./export/pptx-image.js";
import { renderPdfCanvasElement } from "./export/pdf-canvas.js";
import { renderPptxSlideBackground, slideBackgroundVariant } from "./export/pptx-background.js";
import { exceedsExportStorageQuota, exportStoragePolicy } from "./export-storage-policy.js";
import { captureWorkerProductAnalytics } from "../product-analytics.js";

const require = createRequire(import.meta.url);
const PptxGenConstructor = require("@studydeck/pptxgenjs") as new () => {
  layout: string;
  author: string;
  subject: string;
  title: string;
  lang: string;
  theme: Record<string, unknown>;
  ShapeType: Record<string, string>;
  defineLayout: (layout: { name: string; width: number; height: number }) => void;
  addSlide: () => PptxSlide;
  write: (options: { outputType: "nodebuffer" }) => Promise<Buffer>;
};

type PptxSlide = {
  background?: { color: string };
  addImage: (...args: unknown[]) => void;
  addNotes: (notes: string) => void;
  addShape: (...args: unknown[]) => void;
  addText: (...args: unknown[]) => void;
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
  presentationRevision: number;
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
  const { exportId, projectId, type, presentationRevision } = job.data;
  const startedAt = Date.now();
  await prisma.export.update({ where: { id: exportId }, data: { status: "processing" } });

  let uploadedKey: string | undefined;
  try {
    const presentationRow = await prisma.presentation.findUniqueOrThrow({ where: { projectId } });
    if (presentationRow.revision !== presentationRevision) {
      throw new Error("Presentation changed before export rendering; request a new export for the current revision");
    }
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

    const policy = exportStoragePolicy();
    const currentStorage = await prisma.export.aggregate({
      where: { projectId, status: "ready" },
      _sum: { sizeBytes: true },
    });
    const usedBytes = Number(currentStorage._sum.sizeBytes || 0);
    if (exceedsExportStorageQuota(usedBytes, buffer.length, policy)) {
      throw new Error(`Export storage quota exceeded for this project (${policy.quotaBytesPerProject} bytes)`);
    }

    await putObjectBuffer(key, buffer, contentType);
    uploadedKey = key;
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
    const current = await prisma.presentation.findUniqueOrThrow({ where: { projectId }, select: { revision: true } });
    if (current.revision !== presentationRevision) {
      throw new Error("Presentation changed during export rendering; stale artifact was not published");
    }
    await prisma.export.updateMany({ where: { id: exportId, presentationRevision }, data: { status: "ready", objectKey: key, sizeBytes: buffer.length } });
    uploadedKey = undefined;
    const owner = await prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (owner) {
      void captureWorkerProductAnalytics(owner.userId, "export_completed", {
        format: type,
        attempt: job.attemptsMade + 1,
        duration_ms: Date.now() - startedAt,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    captureExportError(error, {
      projectId,
      jobId: job.id,
      exportId,
      exportType: type,
      stage: "render_or_upload",
    });
    if (uploadedKey) {
      try {
        await deleteObject(uploadedKey);
      } catch (cleanupError) {
        logger.error({ exportId, objectKey: uploadedKey, ...errorLogFields(cleanupError) }, "could not delete unpublished export artifact");
      }
    }
    await prisma.export.update({ where: { id: exportId }, data: { status: "failed", objectKey: null, sizeBytes: 0, error: message } });
    const owner = await prisma.project.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (owner) {
      void captureWorkerProductAnalytics(owner.userId, "export_failed", {
        format: type,
        attempt: job.attemptsMade + 1,
        duration_ms: Date.now() - startedAt,
      });
    }
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
      await renderPptxCanvasSlide(pptx, slide, item.canvas, theme, {
        readObjectBuffer,
        contentTypeFromObjectKey,
        warn: (fields, message) => logger.warn(fields, message),
      });
      renderPptxPlaceholders(pptx, slide, item, theme);
      slide.addNotes(item.speakerNotes);
      continue;
    }

    const imageData = await readSlideImageData(item);

    if (imageData && (item.slideKind === "title" || item.slideKind === "section")) {
      await addFittedPptxImage(slide, imageData, { x: 0, y: 0, w: WIDE_LAYOUT.width, h: WIDE_LAYOUT.height }, {
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
      renderPptxSlideBackground(pptx, slide, item, theme, 38);
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
      renderPptxSlideBackground(pptx, slide, item, theme);
      await renderPptxContentSlide(pptx, slide, item, imageData, theme);
    }

    renderPptxAttribution(slide, item, theme);
    renderPptxPlaceholders(pptx, slide, item, theme);
    slide.addNotes(item.speakerNotes);
  }

  return pptx.write({ outputType: "nodebuffer" }) as Promise<Buffer>;
}

function renderPptxAttribution(
  slide: PptxSlide,
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
  slide: PptxSlide,
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

export async function createPdf(presentation: ReturnType<typeof presentationSchema.parse>) {
  const html = await renderPdfHtml(exportCanvasDocument(presentation));
  return renderHtmlToPdf(html, { viewportWidth: 1280, viewportHeight: 720, pageWidth: "1280px", pageHeight: "720px" });
}

function exportCanvasDocument(presentation: ReturnType<typeof presentationSchema.parse>) {
  // Export jobs always arrive here after preflight. This compatibility branch
  // preserves the old template renderer for genuinely legacy, no-canvas
  // presentations while keeping visual-director documents on their canvas
  // source of truth for direct library callers and existing integrations.
  if (presentation.productionQualityGate) return presentation;
  if (presentation.slides.some((slide) => slide.canvas)) return ensureEditableCanvas(presentation);
  return presentation.designBrief ? ensureEditableCanvas(presentation) : presentation;
}

export async function renderPdfHtml(presentation: ReturnType<typeof presentationSchema.parse>) {
  const theme = exportTheme(presentation);
  const slides = await Promise.all(
    presentation.slides.map(async (slide) => {
      if (slide.canvas) {
        const elements = await Promise.all(sortCanvasElements(slide.canvas.elements).map((element) => renderPdfCanvasElement(element, {
          readObjectBuffer,
          contentTypeFromObjectKey,
          warn: (fields, message) => logger.warn(fields, message),
        })));
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
  body { margin: 0; background: #000; font-family: ${exportPdfFontStack()}; }
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
    `--slide-heading-font:${exportPdfFontStack(theme.fonts.heading)}`,
    `--slide-body-font:${exportPdfFontStack(theme.fonts.body)}`,
    `background:${theme.colors.background}`,
  ].join(";");
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
