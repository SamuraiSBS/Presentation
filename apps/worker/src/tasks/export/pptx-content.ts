import {
  hasMeasurableValue,
  metricLead,
  presentationSchema,
} from "@studydeck/shared";
import { addFittedPptxImage } from "./pptx-image.js";
import {
  comparisonRows,
  quoteText,
  sequenceItems,
  slideBodyText,
  type ExportTheme,
} from "./presentation-content.js";

type PresentationSlide = ReturnType<typeof presentationSchema.parse>["slides"][number];

export type PptxContentSlide = {
  addImage: (...args: unknown[]) => void;
  addShape: (...args: unknown[]) => void;
  addText: (...args: unknown[]) => void;
};

export type PptxContentRenderer = {
  ShapeType: Record<string, string>;
};

/**
 * Renders the semantic, no-canvas PPTX layouts. The export workflow owns image
 * loading and slide metadata, while this module owns the template-to-PPTX
 * projection so individual layout changes cannot affect PDF orchestration.
 */
export async function renderPptxContentSlide(
  pptx: PptxContentRenderer,
  slide: PptxContentSlide,
  item: PresentationSlide,
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
  if (layout === "case-study") return renderThreePanelSlide(pptx, slide, item, ["РЎРёС‚СѓР°С†РёСЏ", "Р”РµР№СЃС‚РІРёРµ", "Р РµР·СѓР»СЊС‚Р°С‚"], theme);
  if (layout === "question-answer") return renderQuestionAnswerSlide(pptx, slide, item, theme);
  if (layout === "myth-fact") return renderMythFactSlide(pptx, slide, item, theme);
  if (layout === "metrics") return renderMetricsSlide(pptx, slide, item, theme);
  if (layout === "evidence") return renderEvidenceSlide(pptx, slide, item, theme);
  if (layout === "problem-solution") return renderProblemSolutionSlide(pptx, slide, item, theme);
  if (layout === "explain-example") return renderExplainExampleSlide(pptx, slide, item, theme);
  await renderDefaultContentSlide(slide, item, imageData, theme);
}

function renderSlideTitle(slide: PptxContentSlide, title: string, theme: ExportTheme, options: { centered?: boolean; width?: number; fontSize?: number } = {}) {
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

function renderStatementSlide(slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme, { centered: true, fontSize: 30 });
  slide.addText(slideBodyText(item), { x: 1.35, y: 2.05, w: 10.6, h: 2.85, fontFace: theme.fonts.heading, fontSize: 30, bold: true, color: theme.pptx.text, align: "center", valign: "mid", fit: "shrink" });
}

function renderQuoteSlide(slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme);
  slide.addText(`"${quoteText(item)}"`, { x: 1.1, y: 1.95, w: 11.1, h: 2.6, fontFace: theme.fonts.heading, fontSize: 27, bold: true, italic: false, color: theme.pptx.text, align: "center", valign: "mid", fit: "shrink" });
  if (item.bullets[0]) slide.addText(item.bullets[0], { x: 2.1, y: 4.86, w: 9.1, h: 0.62, fontFace: theme.fonts.body, fontSize: 15, color: theme.pptx.muted, align: "center", fit: "shrink" });
}

function renderDefinitionSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme);
  const definition = item.definition || { term: item.title, text: item.thesis || slideBodyText(item) };
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.9, y: 1.7, w: 11.55, h: 3.45, rectRadius: 0.08, fill: { color: theme.pptx.surfaceAlt }, line: { color: theme.pptx.line } });
  slide.addText(definition.term, { x: 1.25, y: 2.02, w: 10.8, h: 0.82, fontFace: theme.fonts.heading, fontSize: 28, bold: true, color: theme.pptx.text, fit: "shrink" });
  slide.addText(definition.text, { x: 1.25, y: 3.05, w: 10.8, h: 1.35, fontFace: theme.fonts.body, fontSize: 18, color: theme.pptx.muted, fit: "shrink" });
}

function renderSequenceSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme);
  const detailedItems = item.visual.items.filter((entry) => entry.label || entry.text).slice(0, 5);
  const items = detailedItems.length ? detailedItems : sequenceItems(item).slice(0, 5).map((text, index) => ({ label: `РЁР°Рі ${index + 1}`, text }));
  const width = 11.7 / Math.max(items.length, 1);
  items.forEach((text, index) => {
    const x = 0.82 + index * width;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.12, w: width - 0.16, h: 2.7, fill: { color: theme.pptx.surface }, line: { color: theme.pptx.line } });
    slide.addText(String(index + 1), { x: x + 0.18, y: 2.32, w: 0.45, h: 0.36, fontFace: theme.fonts.body, fontSize: 13, bold: true, color: "FFFFFF", fill: { color: theme.pptx.text }, align: "center", valign: "mid" });
    slide.addText(text.label, { x: x + 0.18, y: 2.88, w: width - 0.52, h: 0.48, fontFace: theme.fonts.heading, fontSize: 15, bold: true, color: theme.pptx.text, fit: "shrink" });
    slide.addText(text.text || text.label, { x: x + 0.18, y: 3.45, w: width - 0.52, h: 0.72, fontFace: theme.fonts.body, fontSize: 12, color: theme.pptx.muted, fit: "shrink" });
  });
}

function renderComparisonSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme);
  const rows = comparisonRows(item).slice(0, 3);
  const leftLabel = item.visual.leftLabel || "РџРµСЂРІРѕРµ";
  const rightLabel = item.visual.rightLabel || "Р’С‚РѕСЂРѕРµ";
  slide.addText("РљСЂРёС‚РµСЂРёР№", { x: 0.9, y: 1.7, w: 2.1, h: 0.42, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  slide.addText(leftLabel, { x: 3.15, y: 1.7, w: 4.35, h: 0.42, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  slide.addText(rightLabel, { x: 7.65, y: 1.7, w: 4.8, h: 0.42, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  rows.forEach((row, index) => {
    const y = 2.18 + index * 1.22;
    for (const [x, width, text, bold] of [[0.9, 2.1, row.label || `РљСЂРёС‚РµСЂРёР№ ${index + 1}`, true], [3.15, 4.35, row.left || row.label, false], [7.65, 4.8, row.right || row.label, false]] as const) {
      slide.addShape(pptx.ShapeType.roundRect, { x, y, w: width, h: 0.96, fill: { color: bold ? theme.pptx.surfaceAlt : theme.pptx.surface }, line: { color: theme.pptx.line } });
      slide.addText(text, { x: x + 0.16, y: y + 0.16, w: width - 0.32, h: 0.56, fontFace: bold ? theme.fonts.heading : theme.fonts.body, fontSize: 13, bold, color: bold ? theme.pptx.text : theme.pptx.muted, fit: "shrink" });
    }
  });
}

async function renderImageFocusSlide(slide: PptxContentSlide, item: PresentationSlide, imageData: string, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme, { width: 5.5, fontSize: 28 });
  slide.addText(item.thesis || slideBodyText(item), { x: 0.82, y: 2.0, w: 5.25, h: 2.4, fontFace: theme.fonts.body, fontSize: 18, color: theme.pptx.muted, fit: "shrink" });
  await addFittedPptxImage(slide, imageData, { x: 6.65, y: 0.72, w: 5.95, h: 5.75 }, { fit: "contain", altText: item.visual.image?.alt });
}

function renderThreePanelSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, labels: string[], theme: ExportTheme) {
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

function renderQuestionAnswerSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme, { centered: true, fontSize: 31 });
  slide.addShape(pptx.ShapeType.roundRect, { x: 1.55, y: 2.12, w: 10.2, h: 2.2, fill: { color: theme.pptx.surfaceAlt }, line: { color: theme.pptx.line } });
  slide.addText("РћС‚РІРµС‚", { x: 1.95, y: 2.38, w: 9.4, h: 0.32, fontFace: theme.fonts.heading, fontSize: 12, bold: true, color: theme.pptx.text });
  slide.addText(item.thesis || slideBodyText(item), { x: 1.95, y: 2.95, w: 9.4, h: 0.85, fontFace: theme.fonts.body, fontSize: 18, color: theme.pptx.muted, fit: "shrink" });
  item.bullets.slice(0, 3).forEach((text, index) => {
    const x = 1.55 + index * 3.45;
    slide.addText(["РџРѕС‡РµРјСѓ", "РџСЂРёРјРµСЂ", "Р§С‚Рѕ СЌС‚Рѕ РјРµРЅСЏРµС‚"][index], { x, y: 4.72, w: 3.05, h: 0.28, fontFace: theme.fonts.heading, fontSize: 11, bold: true, color: theme.pptx.text });
    slide.addText(text, { x, y: 5.1, w: 3.05, h: 0.7, fontFace: theme.fonts.body, fontSize: 12, color: theme.pptx.muted, fit: "shrink" });
  });
}

function renderMythFactSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme);
  const visualItems = item.visual.items.slice(0, 2);
  const fallback = sequenceItems(item);
  ["РњРёС„", "Р¤Р°РєС‚"].forEach((label, index) => {
    const x = 0.92 + index * 5.78;
    const entry = visualItems[index];
    const text = entry ? [entry.label, entry.text].filter(Boolean).join(". ") : fallback[index] || item.thesis;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 1.85, w: 5.55, h: 2.0, fill: { color: index ? theme.pptx.surface : theme.pptx.surfaceAlt }, line: { color: theme.pptx.line } });
    slide.addText(label, { x: x + 0.22, y: 2.08, w: 5.1, h: 0.3, fontFace: theme.fonts.heading, fontSize: 12, bold: true, color: theme.pptx.text });
    slide.addText(text, { x: x + 0.22, y: 2.58, w: 5.1, h: 0.82, fontFace: theme.fonts.body, fontSize: 15, color: theme.pptx.muted, fit: "shrink" });
    if (item.bullets[index]) {
      slide.addText(index ? "РџСЂРѕРІРµСЂРєР°" : "РџРѕС‡РµРјСѓ РІ СЌС‚Рѕ РІРµСЂСЏС‚", { x, y: 4.35, w: 5.55, h: 0.28, fontFace: theme.fonts.heading, fontSize: 11, bold: true, color: theme.pptx.text });
      slide.addText(item.bullets[index], { x, y: 4.78, w: 5.55, h: 0.72, fontFace: theme.fonts.body, fontSize: 12, color: theme.pptx.muted, fit: "shrink" });
    }
  });
}

function renderMetricsSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
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

function renderEvidenceSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme);
  slide.addText(item.thesis || slideBodyText(item), { x: 0.9, y: 1.55, w: 11.55, h: 1.0, fontFace: theme.fonts.heading, fontSize: 25, bold: true, color: theme.pptx.text, fit: "shrink" });
  slide.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.68, w: 11.55, h: 0.04, fill: { color: theme.pptx.accent }, line: { transparency: 100 } });
  sequenceItems(item).slice(0, 4).forEach((text, index) => {
    const x = 0.92 + (index % 2) * 5.85;
    const y = 3.02 + Math.floor(index / 2) * 1.15;
    slide.addShape(pptx.ShapeType.ellipse, { x, y: y + 0.06, w: 0.22, h: 0.22, fill: { color: theme.pptx.accentAlt }, line: { transparency: 100 } });
    slide.addText(text, { x: x + 0.38, y, w: 5.25, h: 0.72, fontFace: theme.fonts.body, fontSize: 14, color: theme.pptx.muted, fit: "shrink" });
  });
}

function renderProblemSolutionSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme);
  const items = sequenceItems(item);
  ["РџСЂРѕР±Р»РµРјР°", "РџСЂРёС‡РёРЅР°", "Р РµС€РµРЅРёРµ"].forEach((label, index) => {
    const x = 0.9 + index * 4.05;
    slide.addText(label, { x, y: 1.8, w: 3.55, h: 0.35, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
    slide.addShape(pptx.ShapeType.rect, { x, y: 2.28, w: 3.55, h: 0.04, fill: { color: index === 2 ? theme.pptx.accentAlt : theme.pptx.line }, line: { transparency: 100 } });
    slide.addText(items[index] || item.thesis || slideBodyText(item), { x, y: 2.65, w: 3.55, h: 2.2, fontFace: theme.fonts.body, fontSize: 16, color: theme.pptx.muted, fit: "shrink" });
    if (index < 2) slide.addText("в†’", { x: x + 3.63, y: 3.4, w: 0.3, h: 0.3, fontFace: theme.fonts.heading, fontSize: 16, bold: true, color: theme.pptx.muted, align: "center" });
  });
}

function renderExplainExampleSlide(pptx: PptxContentRenderer, slide: PptxContentSlide, item: PresentationSlide, theme: ExportTheme) {
  renderSlideTitle(slide, item.title, theme);
  const items = sequenceItems(item);
  const definition = item.definition || { term: item.title, text: item.thesis || items[0] || slideBodyText(item) };
  slide.addText(definition.term, { x: 0.9, y: 1.75, w: 4.35, h: 0.75, fontFace: theme.fonts.heading, fontSize: 25, bold: true, color: theme.pptx.text, fit: "shrink" });
  slide.addText(definition.text, { x: 0.9, y: 2.75, w: 4.35, h: 2.15, fontFace: theme.fonts.body, fontSize: 17, color: theme.pptx.muted, fit: "shrink" });
  slide.addShape(pptx.ShapeType.rect, { x: 5.55, y: 1.72, w: 0.03, h: 4.2, fill: { color: theme.pptx.line }, line: { transparency: 100 } });
  slide.addText("РџСЂРёРјРµСЂ", { x: 6.0, y: 1.75, w: 5.3, h: 0.35, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  slide.addText(items[1] || items[0] || item.thesis, { x: 6.0, y: 2.25, w: 5.3, h: 1.35, fontFace: theme.fonts.body, fontSize: 17, bold: true, color: theme.pptx.text, fit: "shrink" });
  slide.addText("Р’Р°Р¶РЅРѕ РїРѕРјРЅРёС‚СЊ", { x: 6.0, y: 4.0, w: 5.3, h: 0.35, fontFace: theme.fonts.heading, fontSize: 13, bold: true, color: theme.pptx.text });
  slide.addText(items[2] || item.bullets[1] || "РџСЂРёРјРµСЂ РїРѕРјРѕРіР°РµС‚ РїРѕРЅСЏС‚СЊ РёРґРµСЋ, РЅРѕ РЅРµ Р·Р°РјРµРЅСЏРµС‚ С‚РѕС‡РЅРѕРµ РѕРїСЂРµРґРµР»РµРЅРёРµ.", { x: 6.0, y: 4.5, w: 5.3, h: 1.05, fontFace: theme.fonts.body, fontSize: 14, color: theme.pptx.muted, fit: "shrink" });
}

async function renderDefaultContentSlide(slide: PptxContentSlide, item: PresentationSlide, imageData: string | null, theme: ExportTheme) {
  const hasSideImage = Boolean(imageData);
  renderSlideTitle(slide, item.title, theme, { centered: !hasSideImage, width: hasSideImage ? 5.5 : 11.9, fontSize: hasSideImage ? 28 : 34 });
  slide.addText(slideBodyText(item), { x: hasSideImage ? 0.82 : 1.5, y: hasSideImage ? 2.05 : 3.55, w: hasSideImage ? 5.35 : 10.33, h: hasSideImage ? 3.5 : 1.45, fontFace: theme.fonts.body, fontSize: hasSideImage ? 18 : 19, color: theme.pptx.muted, align: hasSideImage ? "left" : "center", valign: "mid", breakLine: false, fit: "shrink" });
  if (imageData) await addFittedPptxImage(slide, imageData, { x: 6.72, y: 0.68, w: 5.9, h: 5.85 }, { fit: "contain", altText: item.visual.image?.alt });
}
