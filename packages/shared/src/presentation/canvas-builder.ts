import type { SourceRef } from "../projects/schemas.js";
import type { DesignBriefSlideDirection, SceneTextMode } from "../generation/schemas.js";
import { resolvePresentationTheme } from "./themes.js";
import { presentationLayoutCapacity } from "./layouts.js";
import type {
  CanvasBackgroundStyle,
  CanvasElement,
  CanvasImageElement,
  CanvasShapeElement,
  CanvasTextElement,
  PresentationTheme,
  Slide,
  SlideBlock,
  SlideCanvas,
  SlideVisual,
} from "./schemas.js";
import type { PresentationDocument } from "./document.js";
import { repairUnsafeGeneratedElements } from "./canvas-audit.js";
import { slideBackgroundStyle } from "./canvas-background.js";
import {
  CANVAS_SAFE_BOTTOM,
  cleanCanvasText,
  compactCanvasTextToFit,
  estimatedCharactersPerLine,
  elementsVisuallyOverlap,
  estimatedTextHeight,
  MIN_GENERATED_BODY_FONT_SIZE,
  MIN_GENERATED_CAPTION_FONT_SIZE,
  minimumReadableFontSize,
  sortCanvasElements,
  STUDYDECK_EDITORIAL_THEME_ID,
} from "./canvas-helpers.js";
import { presentationTypography, typographyForCanvasText } from "./typography.js";
import { formatSlideAttribution } from "./attribution.js";

const READABLE_BODY_FONT_SIZE = presentationTypography.body.preferredPx;
const READABLE_PLAQUE_FONT_SIZE = presentationTypography.label.preferredPx;
const PLAQUE_PADDING_X = 18;
const PLAQUE_PADDING_Y = 12;
const EDITORIAL_MARGIN_X = 72;
const EDITORIAL_CONTENT_WIDTH = 1136;
const EDITORIAL_GUTTER = 24;

export function ensureEditableCanvas(document: PresentationDocument): PresentationDocument {
  const theme = resolvePresentationTheme({
    title: document.title,
    scenario: document.scenario,
    level: document.level,
    presentationTheme: document.presentationTheme,
    designBrief: document.designBrief,
  });

  return {
    ...document,
    presentationTheme: theme,
    slides: document.slides.map((slide) => {
      const designDirection = document.designBrief?.slideDirections.find((direction) => direction.slideOrder === slide.order);
      const generatedCanvas = buildSlideCanvas(slide, theme, { designDirection });
      const hasExplicitCustomCanvas = slide.canvas?.elements.some(
        (element) => element.id === `${slide.id}-custom-canvas-marker`,
      );
      const shouldRebuildEditorialCanvas = theme.themeId === STUDYDECK_EDITORIAL_THEME_ID
        && !hasExplicitCustomCanvas;
      return {
        ...slide,
        canvas: hasExplicitCustomCanvas
          ? slide.canvas
          : shouldRebuildEditorialCanvas
          ? generatedCanvas
          : hasCustomSlideCanvas(slide, theme, generatedCanvas)
          ? upgradeCustomCanvas(slide.canvas!, generatedCanvas, theme)
          : generatedCanvas,
      };
    }),
  };
}

type BuildSlideCanvasOptions = {
  designDirection?: DesignBriefSlideDirection;
};

export function buildSlideCanvas(slide: Slide, theme: PresentationTheme, options: BuildSlideCanvasOptions = {}): SlideCanvas {
  // Canvas is a projection of the structured slide, not its source of truth.
  // Keep the rich narration intact while reducing this projection to the
  // capacity of the chosen composition before any font-size fallback occurs.
  slide = constrainSlideToLayoutCapacity(slide);
  if (theme.themeId === STUDYDECK_EDITORIAL_THEME_ID) {
    return buildStudyDeckEditorialCanvas(slide, theme, options.designDirection);
  }

  const visual = slide.visual || { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] };
  const background = theme.colors.background;
  const backgroundStyle = slideBackgroundStyle(slide, theme);
  const text = theme.colors.text;
  const muted = theme.colors.muted;
  const elements: CanvasElement[] = backgroundElements(slide, theme);
  const designDirection = options.designDirection;
  const premium = Boolean(designDirection);

  if (slide.slideKind === "title" || slide.slideKind === "section") {
    if (premium) {
      addPremiumHeroCanvas(slide, theme, elements, designDirection);
      addSlideAttributionCanvas(slide, theme, elements);
      return { version: 2, width: 1280, height: 720, background, backgroundStyle, elements: finalizeGeneratedElements(elements, theme) };
    }

    const isTitleSlide = slide.slideKind === "title";
    if (visual.image) {
      elements.push(imageElement(`${slide.id}-image-bg`, visual.image, 0, 0, 1280, 720, 1, 0.1, "cover"));
    }

    const bodyText = slide.thesis || slideBodyText(slide);
    const bodyY = isTitleSlide ? 306 : 376;
    const bodyFontSize = isTitleSlide ? READABLE_BODY_FONT_SIZE : fittedFontSize(bodyText, 28, 20, 110);
    const bodyHeight = isTitleSlide ? Math.max(112, estimatedTextHeight(bodyText, bodyFontSize, 860)) : 112;

    elements.push(
      textElement(`${slide.id}-title`, slide.title, 178, isTitleSlide ? 118 : 188, 924, 148, 5, {
        role: "title",
        typographyRole: isTitleSlide ? "deckTitle" : "slideTitle",
        fontSize: fittedFontSize(slide.title, 58, 38, 148),
        fontFamily: theme.fonts.heading,
        color: text,
        bold: true,
        align: "center",
        valign: "middle",
      }),
      textElement(`${slide.id}-body`, bodyText, 210, bodyY, 860, bodyHeight, 5, {
        role: "body",
        fontSize: bodyFontSize,
        autoFit: !isTitleSlide,
        fontFamily: theme.fonts.body,
        color: muted,
        align: "center",
        valign: "middle",
      }),
    );

    if (isTitleSlide) addTitleMiniPointGrid(slide, theme, elements, Math.max(430, bodyY + bodyHeight + 36));
    else addMiniPointRow(slide, theme, elements, 296, 512);

    addSlideAttributionCanvas(slide, theme, elements);
    return { version: 2, width: 1280, height: 720, background, backgroundStyle, elements: finalizeGeneratedElements(elements, theme) };
  }

  const directed = premium ? addPremiumDirectedCanvas(slide, theme, elements, designDirection) : false;
  if (directed) {
    addFallbackImageCanvas(slide, elements);
    addSlideAttributionCanvas(slide, theme, elements);
    return { version: 2, width: 1280, height: 720, background, backgroundStyle, elements: finalizeGeneratedElements(elements, theme) };
  }

  if (slide.slideKind === "summary") addSummaryCanvas(slide, theme, elements);
  else if (slide.layout === "statement") addStatementCanvas(slide, theme, elements);
  else if (slide.layout === "quote") addQuoteCanvas(slide, theme, elements);
  else if (slide.layout === "definition") addDefinitionCanvas(slide, theme, elements);
  else if (slide.layout === "timeline" || slide.layout === "process") addSequenceCanvas(slide, theme, elements);
  else if (slide.layout === "comparison" || slide.layout === "two-column") addComparisonCanvas(slide, theme, elements);
  else if (slide.layout === "image-focus" && visual.image) addImageFocusCanvas(slide, theme, elements);
  else if (slide.layout === "case-study") addPanelGridCanvas(slide, theme, elements, ["Ситуация", "Действие", "Результат"]);
  else if (slide.layout === "question-answer") addQuestionAnswerCanvas(slide, theme, elements);
  else if (slide.layout === "myth-fact") addMythFactCanvas(slide, theme, elements);
  else if (slide.layout === "metrics") addMetricsCanvas(slide, theme, elements);
  else if (slide.layout === "evidence") addEvidenceCanvas(slide, theme, elements);
  else if (slide.layout === "problem-solution") addProblemSolutionCanvas(slide, theme, elements);
  else if (slide.layout === "explain-example") addExplainExampleCanvas(slide, theme, elements);
  else addDefaultContentCanvas(slide, theme, elements);

  addFallbackImageCanvas(slide, elements);
  addSlideAttributionCanvas(slide, theme, elements);

  return { version: 2, width: 1280, height: 720, background, backgroundStyle, elements: finalizeGeneratedElements(elements, theme) };
}

function buildStudyDeckEditorialCanvas(
  slide: Slide,
  theme: PresentationTheme,
  direction?: DesignBriefSlideDirection,
): SlideCanvas {
  const dark = slide.slideKind === "title" || slide.slideKind === "section" || slide.slideKind === "summary";
  const background = dark ? theme.colors.text : theme.colors.background;
  const foreground = dark ? theme.colors.background : theme.colors.text;
  const muted = dark ? theme.colors.line : theme.colors.muted;
  const elements: CanvasElement[] = [];

  if (slide.slideKind === "title") {
    addEditorialCoverCanvas(slide, theme, elements, foreground, muted);
  } else if (slide.slideKind === "section") {
    addEditorialSectionCanvas(slide, theme, elements, foreground, muted);
  } else if (slide.slideKind === "summary" || direction?.layoutIntent === "summary") {
    addEditorialSummaryCanvas(slide, theme, elements, foreground, muted);
  } else if (slide.visual?.image) {
    addEditorialImageCanvas(slide, theme, elements);
  } else if (direction?.layoutIntent === "comparison" || slide.layout === "comparison" || slide.layout === "two-column") {
    addEditorialComparisonCanvas(slide, theme, elements);
  } else if (
    direction?.imageStrategy === "diagram" ||
    direction?.layoutIntent === "diagram" ||
    direction?.layoutIntent === "timeline" ||
    slide.layout === "timeline" ||
    slide.layout === "process" ||
    slide.visual?.graph?.nodes.length
  ) {
    addEditorialDiagramCanvas(slide, theme, elements);
  } else if (
    direction?.sceneTextMode === "hero_phrase" ||
    direction?.layoutIntent === "statement" ||
    direction?.layoutIntent === "quote_spread" ||
    slide.layout === "statement" ||
    slide.layout === "quote"
  ) {
    addEditorialStatementCanvas(slide, theme, elements);
  } else {
    addEditorialNarrativeCanvas(slide, theme, elements);
  }

  addSlideAttributionCanvas(slide, theme, elements, muted);

  return {
    version: 3,
    width: 1280,
    height: 720,
    background,
    backgroundStyle: { type: "solid", color: background },
    elements: finalizeEditorialElements(elements),
  };
}

function addEditorialCoverCanvas(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  foreground: string,
  muted: string,
) {
  const image = slide.visual?.image;
  const textWidth = image ? 552 : 920;
  elements.push(
    shapeElement(`${slide.id}-editorial-accent`, "rect", EDITORIAL_MARGIN_X, 112, 86, 7, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-editorial-title`, slide.title, EDITORIAL_MARGIN_X, 154, textWidth, 238, 5, {
      role: "title",
      fontSize: fittedFontSize(slide.title, image ? 64 : 72, 42, 238),
      fontFamily: theme.fonts.heading,
      color: foreground,
      bold: true,
      valign: "middle",
    }),
    textElement(`${slide.id}-editorial-body`, slide.thesis || slideBodyText(slide), EDITORIAL_MARGIN_X, 426, image ? 526 : 760, 118, 5, {
      role: "body",
      fontSize: fittedFontSize(slide.thesis || slideBodyText(slide), 30, 24, 118),
      fontFamily: theme.fonts.body,
      color: muted,
      valign: "middle",
    }),
  );

  if (image) {
    elements.push(
      shapeElement(`${slide.id}-editorial-divider`, "rect", 681, 64, 3, 592, 3, theme.colors.accent, theme.colors.accent, 0, 1),
      imageElement(`${slide.id}-editorial-image`, image, 720, 0, 560, 720, 2, 1, "cover"),
    );
  } else {
    elements.push(
      shapeElement(`${slide.id}-editorial-field`, "rect", 930, 0, 350, 720, 1, theme.colors.accentAlt, theme.colors.accentAlt, 0, 0.18),
      shapeElement(`${slide.id}-editorial-field-accent`, "rect", 1010, 118, 198, 198, 2, theme.colors.accent, theme.colors.accent, 0, 0.92),
    );
  }
  addEditorialFooter(slide, theme, elements, foreground, muted, EDITORIAL_MARGIN_X, image ? 552 : EDITORIAL_CONTENT_WIDTH);
}

function addEditorialSectionCanvas(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  foreground: string,
  muted: string,
) {
  const image = slide.visual?.image;
  if (image) {
    elements.push(imageElement(`${slide.id}-editorial-image`, image, 744, 0, 536, 720, 2, 1, "cover"));
  } else {
    elements.push(shapeElement(`${slide.id}-editorial-field`, "rect", 872, 0, 408, 720, 1, theme.colors.accentAlt, theme.colors.accentAlt, 0, 0.2));
  }
  elements.push(
    shapeElement(`${slide.id}-editorial-accent`, "rect", EDITORIAL_MARGIN_X, 132, 92, 7, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-editorial-title`, slide.title, EDITORIAL_MARGIN_X, 174, image ? 580 : 700, 196, 5, {
      role: "title",
      fontSize: fittedFontSize(slide.title, 60, 40, 196),
      fontFamily: theme.fonts.heading,
      color: foreground,
      bold: true,
      valign: "middle",
    }),
    textElement(`${slide.id}-editorial-body`, slide.thesis || slideBodyText(slide), EDITORIAL_MARGIN_X, 408, image ? 548 : 672, 116, 5, {
      role: "body",
      fontSize: fittedFontSize(slide.thesis || slideBodyText(slide), 30, 24, 116),
      fontFamily: theme.fonts.body,
      color: muted,
    }),
  );
  addEditorialFooter(slide, theme, elements, foreground, muted, EDITORIAL_MARGIN_X, image ? 580 : EDITORIAL_CONTENT_WIDTH);
}

function addEditorialImageCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const image = slide.visual?.image;
  if (!image) return;
  const imageOnRight = slide.order % 2 === 0;
  const imageX = imageOnRight ? 704 : 0;
  const textX = imageOnRight ? EDITORIAL_MARGIN_X : 648;
  const textWidth = 520;
  const thesis = slide.thesis || slideBodyText(slide);
  const support = editorialSupportItems(slide, thesis, 2);

  elements.push(
    imageElement(`${slide.id}-editorial-image`, image, imageX, 0, 576, 720, 2, 1, imageFitForVisual(slide)),
    shapeElement(`${slide.id}-editorial-accent`, "rect", textX, 58, 68, 6, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-editorial-title`, slide.title, textX, 88, textWidth, 124, 5, {
      role: "title",
      fontSize: fittedFontSize(slide.title, 48, 34, 124),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-editorial-thesis`, thesis, textX, 220, textWidth, 220, 5, {
      role: "body",
      fontSize: fittedFontSize(thesis, 32, 24, 200),
      fontFamily: theme.fonts.body,
      color: theme.colors.text,
      bold: true,
      valign: "middle",
    }),
  );

  support.forEach((item, index) => {
    const y = 462 + index * 92;
    elements.push(
      shapeElement(`${slide.id}-editorial-support-${index}-rule`, "rect", textX, y, 44, 3, 3, index ? theme.colors.accentAlt : theme.colors.accent, index ? theme.colors.accentAlt : theme.colors.accent, 0, 1),
      textElement(`${slide.id}-editorial-support-${index}`, item, textX, y + 16, textWidth, 76, 5, {
        role: "body",
        fontSize: fittedFontSize(item, 23, MIN_GENERATED_BODY_FONT_SIZE, 76),
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
  addEditorialFooter(slide, theme, elements, theme.colors.text, theme.colors.muted, textX, textWidth);
}

function addEditorialNarrativeCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const thesis = slide.thesis || slideBodyText(slide);
  const support = editorialSupportItems(slide, thesis, 3);
  addEditorialContentTitle(slide, theme, elements);
  elements.push(
    textElement(`${slide.id}-editorial-thesis`, thesis, EDITORIAL_MARGIN_X, 214, 520, 264, 5, {
      role: "title",
      fontSize: fittedFontSize(thesis, 44, 30, 264),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      valign: "middle",
    }),
    shapeElement(`${slide.id}-editorial-divider`, "rect", 640, 204, 2, 330, 2, theme.colors.line, theme.colors.line, 0, 1),
  );

  support.forEach((item, index) => {
    const y = 208 + index * 112;
    elements.push(
      shapeElement(`${slide.id}-editorial-support-${index}-dot`, "ellipse", 704, y + 6, 16, 16, 3, index === 1 ? theme.colors.accentAlt : theme.colors.accent, index === 1 ? theme.colors.accentAlt : theme.colors.accent, 0, 1),
      textElement(`${slide.id}-editorial-support-${index}`, item, 744, y, 440, 82, 5, {
        role: "body",
        fontSize: 25,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
  addEditorialFooter(slide, theme, elements, theme.colors.text, theme.colors.muted);
}

function addEditorialStatementCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const phrase = slide.thesis || quoteText(slide) || slide.title;
  const support = editorialSupportItems(slide, phrase, 2);
  elements.push(
    textElement(`${slide.id}-editorial-title`, slide.title, EDITORIAL_MARGIN_X, 62, EDITORIAL_CONTENT_WIDTH, 68, 5, {
      role: "body",
      fontSize: 28,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
      bold: true,
    }),
    shapeElement(`${slide.id}-editorial-accent`, "rect", EDITORIAL_MARGIN_X, 156, 94, 7, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-editorial-phrase`, phrase, 112, 196, 1056, 270, 5, {
      role: "title",
      fontSize: fittedFontSize(phrase, 58, 36, 270),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      align: "center",
      valign: "middle",
    }),
  );
  support.forEach((item, index) => {
    const width = support.length === 1 ? 720 : 500;
    const x = support.length === 1 ? 280 : 112 + index * 556;
    elements.push(
      shapeElement(`${slide.id}-editorial-support-${index}-rule`, "rect", x, 528, width, 2, 3, index ? theme.colors.accentAlt : theme.colors.accent, index ? theme.colors.accentAlt : theme.colors.accent, 0, 1),
      textElement(`${slide.id}-editorial-support-${index}`, item, x, 550, width, 66, 5, {
        role: "body",
        fontSize: 23,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
        align: "center",
      }),
    );
  });
  addEditorialFooter(slide, theme, elements, theme.colors.text, theme.colors.muted);
}

function addEditorialComparisonCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const rows = comparisonRows(slide).slice(0, 3);
  const leftLabel = cleanCanvasText(slide.visual?.leftLabel) || "Первая сторона";
  const rightLabel = cleanCanvasText(slide.visual?.rightLabel) || "Вторая сторона";
  addEditorialContentTitle(slide, theme, elements);
  elements.push(
    textElement(`${slide.id}-editorial-comparison-intro`, slide.thesis, EDITORIAL_MARGIN_X, 158, EDITORIAL_CONTENT_WIDTH, 62, 5, {
      role: "body",
      fontSize: 26,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
    textElement(`${slide.id}-editorial-comparison-left-label`, leftLabel, EDITORIAL_MARGIN_X, 248, 504, 48, 5, {
      role: "body",
      fontSize: 28,
      fontFamily: theme.fonts.heading,
      color: theme.colors.accent,
      bold: true,
    }),
    textElement(`${slide.id}-editorial-comparison-right-label`, rightLabel, 704, 248, 504, 48, 5, {
      role: "body",
      fontSize: 28,
      fontFamily: theme.fonts.heading,
      color: theme.colors.accentAlt,
      bold: true,
    }),
    shapeElement(`${slide.id}-editorial-comparison-divider`, "rect", 639, 246, 2, 352, 2, theme.colors.line, theme.colors.line, 0, 1),
  );
  rows.forEach((row, index) => {
    const y = 328 + index * 92;
    elements.push(
      textElement(`${slide.id}-editorial-comparison-left-${index}`, row.left, EDITORIAL_MARGIN_X, y, 504, 64, 5, {
        role: "body",
        fontSize: 23,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.text,
      }),
      textElement(`${slide.id}-editorial-comparison-right-${index}`, row.right, 704, y, 504, 64, 5, {
        role: "body",
        fontSize: 23,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.text,
      }),
    );
    if (index < rows.length - 1) {
      elements.push(
        shapeElement(`${slide.id}-editorial-comparison-left-rule-${index}`, "rect", EDITORIAL_MARGIN_X, y + 72, 504, 1, 2, theme.colors.line, theme.colors.line, 0, 1),
        shapeElement(`${slide.id}-editorial-comparison-right-rule-${index}`, "rect", 704, y + 72, 504, 1, 2, theme.colors.line, theme.colors.line, 0, 1),
      );
    }
  });
  addEditorialFooter(slide, theme, elements, theme.colors.text, theme.colors.muted);
}

function addEditorialDiagramCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const thesis = slide.thesis || slideBodyText(slide);
  const groupId = `group:${slide.id}-editorial-visual-field`;
  addEditorialContentTitle(slide, theme, elements);
  elements.push(
    textElement(`${slide.id}-editorial-thesis`, thesis, EDITORIAL_MARGIN_X, 194, 322, 326, 5, {
      role: "body",
      // This is explanatory copy beside a diagram, not the slide's hero
      // claim. Keep the semantic token explicit so the `-thesis` id does not
      // force main-claim sizing and crowd the visual field.
      typographyRole: "body",
      fontSize: fittedFontSize(thesis, 34, 26, 326),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      valign: "middle",
    }),
    { ...shapeElement(`${slide.id}-editorial-visual-field`, "roundRect", 448, 166, 760, 440, 2, theme.colors.surfaceAlt, theme.colors.surfaceAlt, 0, 1), groupId },
  );

  if (slide.visual?.graph?.nodes.length) {
    addEditorialGraphVisual(slide, theme, elements, groupId);
  } else {
    addEditorialSequenceVisual(slide, theme, elements, groupId);
  }
  addEditorialFooter(slide, theme, elements, theme.colors.text, theme.colors.muted);
}

function addEditorialGraphVisual(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], groupId: string) {
  const graph = slide.visual?.graph;
  if (!graph) return;
  const nodes = graph.nodes.slice(0, 5);
  const horizontal = graph.layoutDirection !== "TB";
  const nodeWidth = horizontal ? Math.max(120, (680 - Math.max(0, nodes.length - 1) * EDITORIAL_GUTTER) / Math.max(1, nodes.length)) : 560;
  const startX = horizontal ? 488 : 548;
  const startY = horizontal ? 270 : 202;
  nodes.forEach((node, index) => {
    const x = horizontal ? startX + index * (nodeWidth + EDITORIAL_GUTTER) : startX;
    const y = horizontal ? startY : startY + index * 76;
    elements.push(
      shapeElement(`${slide.id}-editorial-node-${index}-dot`, "ellipse", x, y, 36, 36, 4, index % 2 ? theme.colors.accentAlt : theme.colors.accent, index % 2 ? theme.colors.accentAlt : theme.colors.accent, 0, 1),
      textElement(`${slide.id}-editorial-node-${index}-label`, node.label, horizontal ? x : x + 58, horizontal ? y + 58 : y - 2, horizontal ? nodeWidth : 490, horizontal ? 68 : 40, 5, {
        role: "body",
        fontSize: 23,
        autoFit: false,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
        groupId,
      }),
    );
    if (node.detail && horizontal) {
      elements.push(textElement(`${slide.id}-editorial-node-${index}-detail`, compactSummaryPoint(node.detail, 9), x, y + 130, nodeWidth, 50, 5, {
        role: "caption",
        fontSize: 19,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
        groupId,
      }));
    }
    if (index < nodes.length - 1) {
      elements.push(shapeElement(
        `${slide.id}-editorial-node-${index}-connector`,
        "rect",
        horizontal ? x + 42 : x + 16,
        horizontal ? y + 16 : y + 42,
        horizontal ? Math.max(12, nodeWidth - 52 + EDITORIAL_GUTTER) : 3,
        horizontal ? 3 : 30,
        3,
        theme.colors.line,
        theme.colors.line,
        0,
        1,
      ));
    }
  });
}

function addEditorialSequenceVisual(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], groupId: string) {
  const items = uniqueCanvasItems(sequenceItems(slide)).slice(0, 4);
  const safeItems = items.length >= 2 ? items : editorialSupportItems(slide, slide.thesis, 3);
  const count = Math.max(1, safeItems.length);
  const columnWidth = Math.min(188, (672 - Math.max(0, count - 1) * EDITORIAL_GUTTER) / count);
  const startX = 492;
  safeItems.forEach((item, index) => {
    const x = startX + index * (columnWidth + EDITORIAL_GUTTER);
    elements.push(
      textElement(`${slide.id}-editorial-step-${index}-number`, String(index + 1).padStart(2, "0"), x, 226, columnWidth, 46, 5, {
        role: "body",
        typographyRole: "label",
        fontSize: 30,
        fontFamily: theme.fonts.heading,
        color: index % 2 ? theme.colors.accentAlt : theme.colors.accent,
        bold: true,
        groupId,
      }),
      shapeElement(`${slide.id}-editorial-step-${index}-rule`, "rect", x, 292, columnWidth, 3, 4, theme.colors.line, theme.colors.line, 0, 1),
      textElement(`${slide.id}-editorial-step-${index}-text`, compactSummaryPoint(item, 11), x, 326, columnWidth, 176, 5, {
        role: "body",
        typographyRole: "supporting",
        fontSize: 23,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.text,
        groupId,
      }),
    );
  });
}

function addEditorialSummaryCanvas(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  foreground: string,
  muted: string,
) {
  const conclusion = slide.thesis || slideBodyText(slide);
  const support = editorialSupportItems(slide, conclusion, 3);
  elements.push(
    textElement(`${slide.id}-editorial-title`, slide.title, EDITORIAL_MARGIN_X, 62, 720, 62, 5, {
      role: "body",
      fontSize: 28,
      fontFamily: theme.fonts.body,
      color: muted,
      bold: true,
    }),
    shapeElement(`${slide.id}-editorial-accent`, "rect", EDITORIAL_MARGIN_X, 154, 96, 7, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-editorial-conclusion`, conclusion, EDITORIAL_MARGIN_X, 196, 708, 334, 5, {
      role: "title",
      fontSize: fittedFontSize(conclusion, 52, 34, 334),
      fontFamily: theme.fonts.heading,
      color: foreground,
      bold: true,
      valign: "middle",
    }),
  );
  support.forEach((item, index) => {
    const y = 190 + index * 126;
    elements.push(
      shapeElement(`${slide.id}-editorial-support-${index}-rule`, "rect", 884, y, 44, 4, 3, index === 1 ? theme.colors.accentAlt : theme.colors.accent, index === 1 ? theme.colors.accentAlt : theme.colors.accent, 0, 1),
      textElement(`${slide.id}-editorial-support-${index}`, item, 884, y + 22, 324, 80, 5, {
        role: "body",
        fontSize: 24,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: muted,
      }),
    );
  });
  addEditorialFooter(slide, theme, elements, foreground, muted);
}

function addEditorialContentTitle(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  elements.push(
    shapeElement(`${slide.id}-editorial-accent`, "rect", EDITORIAL_MARGIN_X, 48, 64, 6, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-editorial-title`, slide.title, EDITORIAL_MARGIN_X, 70, EDITORIAL_CONTENT_WIDTH, 82, 5, {
      role: "title",
      fontSize: fittedFontSize(slide.title, 46, 34, 82),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
  );
}

function addEditorialFooter(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  foreground: string,
  muted: string,
  x = EDITORIAL_MARGIN_X,
  width = EDITORIAL_CONTENT_WIDTH,
) {
  elements.push(
    shapeElement(`${slide.id}-editorial-footer-line`, "rect", x, 668, width, 1, 3, muted, muted, 0, 0.72),
    textElement(`${slide.id}-editorial-footer-order`, String(slide.order).padStart(2, "0"), x + width - 48, 680, 48, 24, 5, {
      role: "caption",
      fontSize: 18,
      autoFit: false,
      fontFamily: theme.fonts.body,
      color: foreground,
      bold: true,
      align: "right",
    }),
  );
}

function editorialSupportItems(slide: Slide, reference: string, limit: number) {
  return uniqueCanvasItems([
    ...(slide.bullets || []),
    ...(slide.visual?.items || []).map((item) => [item.label, item.text].filter(Boolean).join(": ")),
  ])
    .filter((item) => !isDuplicateCanvasText(item, reference) && !isDuplicateCanvasText(item, slide.title))
    .map((item) => compactSummaryPoint(item, 12) || item)
    .slice(0, limit);
}

function finalizeEditorialElements(elements: CanvasElement[]) {
  return sortCanvasElements(clampCanvasElements(repairUnsafeGeneratedElements(elements)));
}

function addPremiumHeroCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], direction?: DesignBriefSlideDirection) {
  const image = slide.visual?.image;
  const editorial = theme.themeId === "editorialMagazine" || direction?.layoutIntent === "full_bleed_image";
  if (image) {
    elements.push(imageElement(`${slide.id}-premium-image-bg`, image, editorial ? 0 : 710, 0, editorial ? 1280 : 570, 720, 1, editorial ? 0.24 : 0.82, "cover"));
    elements.push(shapeElement(`${slide.id}-premium-image-wash`, "rect", 0, 0, editorial ? 1280 : 760, 720, 2, theme.colors.background, theme.colors.background, 0, editorial ? 0.68 : 0.92));
  }

  const leftAligned = editorial || direction?.layoutIntent === "split_image_text";
  const titleX = leftAligned ? 86 : 156;
  const titleW = leftAligned ? 720 : 968;
  const bodyText = slide.thesis || slideBodyText(slide);
  const bodyY = leftAligned ? 372 : 364;
  const isTitleSlide = slide.slideKind === "title";
  const bodyFontSize = isTitleSlide ? READABLE_BODY_FONT_SIZE : fittedFontSize(bodyText, 30, 19, 112);
  const bodyHeight = isTitleSlide ? Math.max(112, estimatedTextHeight(bodyText, bodyFontSize, titleW)) : 112;
  elements.push(
    shapeElement(`${slide.id}-premium-accent`, "rect", titleX, leftAligned ? 126 : 108, 138, 6, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-title`, slide.title, titleX, leftAligned ? 162 : 156, titleW, 172, 5, {
      role: "title",
      fontSize: fittedFontSize(slide.title, leftAligned ? 62 : 64, 36, 172),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      align: leftAligned ? "left" : "center",
      valign: "middle",
    }),
    textElement(`${slide.id}-body`, bodyText, titleX, bodyY, titleW, bodyHeight, 5, {
      role: "body",
      fontSize: bodyFontSize,
      autoFit: !isTitleSlide,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
      align: leftAligned ? "left" : "center",
      valign: "middle",
    }),
  );

  if (isTitleSlide) addTitleMiniPointGrid(slide, theme, elements, Math.max(512, bodyY + bodyHeight + 36));
  else addMiniPointRow(slide, theme, elements, leftAligned ? 86 : 296, 544);
}

function addPremiumDirectedCanvas(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  direction?: DesignBriefSlideDirection,
) {
  const mode = sceneTextModeForSlide(slide, direction);
  if (slide.slideKind === "summary" || direction?.layoutIntent === "summary" || mode === "takeaway") {
    addSummaryCanvas(slide, theme, elements);
    return true;
  }

  const intent = direction?.layoutIntent;
  if ((intent === "full_bleed_image" || intent === "split_image_text") && slide.visual?.image) {
    addPremiumSplitImageCanvas(slide, theme, elements, intent === "full_bleed_image");
    return true;
  }
  if (mode === "talk_sentences" && (intent === "cards" || intent === "statement" || intent === "metric")) {
    addModernTalkCanvas(slide, theme, elements);
    return true;
  }
  if (mode === "hero_phrase" && (!intent || intent === "cards" || intent === "statement" || intent === "metric")) {
    addModernHeroPhraseCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "cards" || (theme.themeId === "startupPitch" && slide.layout === "bullets")) {
    addPremiumCardsCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "timeline") {
    addSequenceCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "comparison") {
    addComparisonCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "evidence_board") {
    addEvidenceCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "quote_spread") {
    addQuoteCanvas(slide, theme, elements);
    return true;
  }
  if (intent === "diagram" || direction?.imageStrategy === "diagram") {
    addDirectedDiagramCanvas(slide, theme, elements, direction);
    return true;
  }
  if (intent === "metric") {
    addMetricsCanvas(slide, theme, elements);
    return true;
  }
  return false;
}

function sceneTextModeForSlide(slide: Slide, direction?: DesignBriefSlideDirection): SceneTextMode {
  if (direction?.sceneTextMode) return direction.sceneTextMode;
  if (slide.slideKind === "title" || direction?.visualRole === "hero") return "hero_phrase";
  if (slide.slideKind === "summary" || direction?.visualRole === "summary" || direction?.layoutIntent === "summary") return "takeaway";
  if (direction?.imageStrategy === "diagram" || direction?.layoutIntent === "diagram" || direction?.layoutIntent === "timeline") return "visual_labels";
  if (direction?.layoutIntent === "quote_spread") return "hero_phrase";
  return "talk_sentences";
}

function addDirectedDiagramCanvas(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  direction?: DesignBriefSlideDirection,
) {
  const visualType = slide.visual?.type || "none";
  const sceneText = `${slide.title} ${slide.thesis} ${direction?.visualPrompt || ""}`;
  if (slide.visual?.graph?.nodes.length) {
    addGraphCanvas(slide, theme, elements);
    return;
  }
  if (
    visualType === "process_diagram" ||
    slide.layout === "process" ||
    slide.layout === "timeline" ||
    /process|workflow|cycle|stage|step|timeline|процесс|цикл|этап|шаг|хронолог/iu.test(sceneText)
  ) {
    addSequenceCanvas(slide, theme, elements);
    return;
  }
  if (visualType === "comparison_diagram" || slide.visual?.rows.length || /compare|comparison|versus|сравнен/iu.test(sceneText)) {
    addComparisonCanvas(slide, theme, elements);
    return;
  }
  if (slide.sourceRefs.length > 0 && direction?.visualRole === "evidence") {
    addEvidenceCanvas(slide, theme, elements);
    return;
  }
  if (slide.layout === "problem-solution" || /cause|effect|problem|solution|причин|следств|проблем|решен/iu.test(sceneText)) {
    addProblemSolutionCanvas(slide, theme, elements);
    return;
  }
  const items = uniqueCanvasItems(sequenceItems(slide)).slice(0, 3);
  if (items.length < 2) {
    addStatementCanvas(slide, theme, elements);
    return;
  }
  addPanelGridCanvas(slide, theme, elements, items.map((_, index) => String(index + 1).padStart(2, "0")));
}

function addGraphCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const graph = slide.visual?.graph;
  if (!graph?.nodes.length) return;

  const nodes = graph.nodes.slice(0, 8);
  const direction = graph.layoutDirection || "LR";
  const left = 100;
  const top = 190;
  const width = 1080;
  const height = 360;
  const nodeWidth = direction === "TB" ? 520 : Math.max(188, Math.min(300, (width - (nodes.length - 1) * 22) / nodes.length));
  const nodeHeight = direction === "TB" ? Math.max(74, Math.min(108, (height - (nodes.length - 1) * 16) / nodes.length)) : 126;
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();

  nodes.forEach((node, index) => {
    const x = direction === "TB" ? left + (width - nodeWidth) / 2 : left + index * (nodeWidth + 22);
    const y = direction === "TB" ? top + index * (nodeHeight + 16) : top + (index % 2 === 0 ? 0 : 92);
    positions.set(node.id, { x, y, w: nodeWidth, h: nodeHeight });
  });

  graph.edges.slice(0, 12).forEach((edge, index) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return;
    const x1 = direction === "TB" ? source.x + source.w / 2 : source.x + source.w;
    const y1 = direction === "TB" ? source.y + source.h : source.y + source.h / 2;
    const x2 = direction === "TB" ? target.x + target.w / 2 : target.x;
    const y2 = direction === "TB" ? target.y : target.y + target.h / 2;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.max(2, Math.abs(x2 - x1));
    const h = Math.max(2, Math.abs(y2 - y1));
    elements.push(shapeElement(`${slide.id}-graph-edge-${index}`, "line", x, y, w, h, 1, theme.colors.line, theme.colors.accent, 3, 0.75));
    if (edge.label) {
      elements.push(textElement(`${slide.id}-graph-edge-${index}-label`, edge.label, x + w / 2 - 70, y + h / 2 - 15, 140, 30, 3, {
        role: "caption",
        fontSize: MIN_GENERATED_CAPTION_FONT_SIZE,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
        align: "center",
        valign: "middle",
      }));
    }
  });

  nodes.forEach((node, index) => {
    const box = positions.get(node.id);
    if (!box) return;
    elements.push(
      shapeElement(`${slide.id}-graph-node-${index}`, "roundRect", box.x, box.y, box.w, box.h, 2, theme.colors.surface, theme.colors.accent, 2, 1),
      textElement(`${slide.id}-graph-node-${index}-label`, node.label, box.x + 18, box.y + 18, box.w - 36, node.detail ? 34 : box.h - 36, 4, {
        role: "body",
        fontSize: 20,
        autoFit: false,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
        align: "center",
        valign: "middle",
      }),
    );
    if (node.detail) {
      elements.push(textElement(`${slide.id}-graph-node-${index}-detail`, node.detail, box.x + 18, box.y + 58, box.w - 36, box.h - 74, 4, {
        role: "caption",
        fontSize: MIN_GENERATED_CAPTION_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
        align: "center",
      }));
    }
  });
}

function addPremiumSplitImageCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], fullBleed: boolean) {
  const image = slide.visual?.image;
  const bodyText = slide.thesis || slideBodyText(slide);
  const bodyY = 310;
  const bodyHeight = Math.max(148, estimatedTextHeight(bodyText, READABLE_BODY_FONT_SIZE, 548));
  if (image) {
    elements.push(imageElement(`${slide.id}-premium-image`, image, fullBleed ? 0 : 700, 0, fullBleed ? 1280 : 580, 720, 1, fullBleed ? 0.34 : 0.9, imageFitForVisual(slide)));
    elements.push(shapeElement(`${slide.id}-premium-copy-wash`, "rect", 0, 0, fullBleed ? 740 : 710, 720, 2, theme.colors.background, theme.colors.background, 0, fullBleed ? 0.84 : 0.96));
  }
  elements.push(
    shapeElement(`${slide.id}-premium-rule`, "rect", 84, 122, 92, 5, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-title`, slide.title, 84, 154, 560, 118, 5, {
      role: "title",
      fontSize: fittedFontSize(slide.title, 44, 28, 118),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-body`, bodyText, 84, bodyY, 548, bodyHeight, 5, {
      role: "body",
      fontSize: READABLE_BODY_FONT_SIZE,
      autoFit: false,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
  addMiniPointRow(slide, theme, elements, 84, Math.max(548, bodyY + bodyHeight + 36), { rightBoundary: 672, maxBottom: 680 });
}

function addModernHeroPhraseCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const image = slide.visual?.image;
  if (image) {
    elements.push(
      imageElement(`${slide.id}-poster-image`, image, 0, 0, 1280, 720, 1, 0.34, "cover"),
      shapeElement(`${slide.id}-poster-wash`, "rect", 0, 0, 1280, 720, 2, theme.colors.background, theme.colors.background, 0, 0.78),
    );
  }

  const phrase = slide.thesis || quoteText(slide) || slide.title;
  const support = uniqueCanvasItems(sequenceItems(slide).filter((item) => !isDuplicateCanvasText(item, phrase))).slice(0, 2);
  elements.push(
    shapeElement(`${slide.id}-poster-rule`, "rect", 92, 118, 132, 6, 3, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-poster-title`, slide.title, 92, 156, 470, 52, 5, {
      role: "caption",
      fontSize: 24,
      autoFit: false,
      fontFamily: theme.fonts.heading,
      color: theme.colors.muted,
      bold: true,
    }),
    textElement(`${slide.id}-poster-phrase`, phrase, 92, 238, 880, 230, 5, {
      role: "title",
      fontSize: fittedFontSize(phrase, 62, 34, 230),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      valign: "middle",
    }),
  );
  if (support.length) {
    addMiniPointRow({ ...slide, bullets: support }, theme, elements, 92, 548, { rightBoundary: 1020, maxBottom: 680 });
  }
}

function addModernTalkCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const beats = talkBeats(slide).slice(0, 4);
  const thesis = slide.thesis || beats[0] || slideBodyText(slide);
  elements.push(
    shapeElement(`${slide.id}-talk-accent`, "rect", 78, 116, 7, 486, 2, theme.colors.accent, theme.colors.accent, 0, 1),
    textElement(`${slide.id}-talk-title`, slide.title, 112, 70, 1030, 82, 4, {
      role: "title",
      fontSize: fittedFontSize(slide.title, 42, 28, 82),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-talk-thesis`, thesis, 112, 182, 480, 190, 4, {
      role: "body",
      fontSize: fittedFontSize(thesis, 36, 24, 190),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      valign: "middle",
    }),
  );

  beats.forEach((beat, index) => {
    const y = 174 + index * 136;
    elements.push(
      textElement(`${slide.id}-talk-number-${index}`, String(index + 1).padStart(2, "0"), 670, y + 4, 54, 34, 4, {
        role: "caption",
        fontSize: 22,
        autoFit: false,
        fontFamily: theme.fonts.heading,
        color: theme.colors.accent,
        bold: true,
        align: "center",
      }),
      shapeElement(`${slide.id}-talk-line-${index}`, "rect", 748, y + 20, 358, 2, 2, theme.colors.line, theme.colors.line, 0, 1),
      textElement(`${slide.id}-talk-beat-${index}`, beat, 670, y + 60, 454, 66, 4, {
        role: "body",
        fontSize: fittedFontSize(beat, 23, MIN_GENERATED_BODY_FONT_SIZE, 56),
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addPremiumCardsCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = uniqueCanvasItems(sequenceItems(slide)).slice(0, 4);
  const columns = Math.max(1, items.length);
  const cardWidth = columns === 1 ? 820 : (1096 - (columns - 1) * 22) / columns;
  const totalWidth = columns * cardWidth + (columns - 1) * 22;
  const startX = (1280 - totalWidth) / 2;
  elements.push(textElement(`${slide.id}-premium-kicker`, slide.thesis || slide.visual?.title || "", 92, 184, 1096, 56, 4, {
    role: "body",
    fontSize: MIN_GENERATED_BODY_FONT_SIZE,
    fontFamily: theme.fonts.body,
    color: theme.colors.muted,
    align: "center",
  }));
  items.forEach((item, index) => {
    const x = startX + index * (cardWidth + 22);
    const cardText = compactSummaryPoint(item, 12) || item;
    elements.push(
      shapeElement(`${slide.id}-premium-card-${index}`, "roundRect", x, 270, cardWidth, 248, 2, index % 2 ? theme.colors.surface : theme.colors.surfaceAlt, theme.colors.line, 1, 1),
      textElement(`${slide.id}-premium-card-${index}-label`, String(index + 1).padStart(2, "0"), x + 22, 294, cardWidth - 44, 36, 4, {
        role: "caption",
        fontSize: 24,
        fontFamily: theme.fonts.heading,
        color: theme.colors.accent,
        bold: true,
      }),
      textElement(`${slide.id}-premium-card-${index}-text`, cardText, x + 22, 356, cardWidth - 44, 128, 4, {
        role: "body",
        fontSize: MIN_GENERATED_BODY_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function finalizeGeneratedElements(elements: CanvasElement[], theme: PresentationTheme) {
  const withBackplates = addStandaloneTextBackplates(elements, theme);
  const linked = linkContainedElements(withBackplates);
  const clamped = clampCanvasElements(repairUnsafeGeneratedElements(linked));
  return sortCanvasElements(clampCanvasElements(syncGroupedTextContainers(syncTextBackplates(clamped))));
}

function addStandaloneTextBackplates(elements: CanvasElement[], theme: PresentationTheme) {
  const resizedElements = reflowTextPlaques(resizeTextPlaques(elements));
  const containers = resizedElements.filter((element): element is CanvasShapeElement =>
    element.type === "shape" && element.shape !== "line",
  );
  const result: CanvasElement[] = [];

  resizedElements.forEach((element) => {
    if (element.type !== "text" || element.id.endsWith("-quote-mark")) {
      result.push(element);
      return;
    }

    const centerX = element.x + element.w / 2;
    const centerY = element.y + element.h / 2;
    const alreadyContained = containers.some((shape) =>
      centerX >= shape.x &&
      centerX <= shape.x + shape.w &&
      centerY >= shape.y &&
      centerY <= shape.y + shape.h,
    );
    if (alreadyContained) {
      result.push(element);
      return;
    }

    // Editorial support rows have deliberately fixed slots. Expanding a long
    // sentence here makes adjacent rows overlap and can push the footer out.
    const fittedElement = /-editorial-support-\d+$/.test(element.id)
      ? element
      : fitCanvasTextElement(element);
    const paddingX = fittedElement.role === "title" ? 26 : 18;
    const paddingY = fittedElement.role === "title" ? 16 : 12;
    const backplate = shapeElement(
      `${fittedElement.id}-backplate`,
      "roundRect",
      fittedElement.x - paddingX,
      fittedElement.y - paddingY,
      fittedElement.w + paddingX * 2,
      fittedElement.h + paddingY * 2,
      Math.max(1, fittedElement.zIndex - 1),
      theme.colors.surface,
      theme.colors.line,
      1,
      0.92,
      true,
    );
    result.push(backplate, fittedElement);
  });

  return result;
}

function syncTextBackplates(elements: CanvasElement[]) {
  const textByBackplateId = new Map(
    elements
      .filter((element): element is CanvasTextElement => element.type === "text")
      .map((element) => [`${element.id}-backplate`, element]),
  );

  return elements.map((element) => {
    if (element.type !== "shape") return element;
    const text = textByBackplateId.get(element.id);
    if (!text) return element;
    const paddingX = text.role === "title" ? 26 : 18;
    const paddingY = text.role === "title" ? 16 : 12;
    const left = Math.min(text.x, Math.max(0, text.x - paddingX));
    const top = Math.min(text.y, Math.max(0, text.y - paddingY));
    const right = Math.max(text.x + text.w, Math.min(1280, text.x + text.w + paddingX));
    const bottom = Math.max(text.y + text.h, Math.min(720, text.y + text.h + paddingY));
    return {
      ...element,
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
    };
  });
}

function syncGroupedTextContainers(elements: CanvasElement[]) {
  const textsByGroupId = new Map<string, CanvasTextElement[]>();
  elements.forEach((element) => {
    if (element.type !== "text" || !element.groupId) return;
    textsByGroupId.set(element.groupId, [...(textsByGroupId.get(element.groupId) || []), element]);
  });

  return elements.map((element) => {
    if (element.type !== "shape" || !element.groupId) return element;
    const texts = textsByGroupId.get(element.groupId);
    if (!texts?.length) return element;
    const left = Math.min(element.x, ...texts.map((text) => text.x));
    const top = Math.min(element.y, ...texts.map((text) => text.y));
    const right = Math.max(element.x + element.w, ...texts.map((text) => text.x + text.w));
    const bottom = Math.max(element.y + element.h, ...texts.map((text) => text.y + text.h));
    const x = Math.max(0, Math.min(left, ...texts.map((text) => text.x)));
    const y = Math.max(0, Math.min(top, ...texts.map((text) => text.y)));
    const safeRight = Math.min(1280, Math.max(right, ...texts.map((text) => text.x + text.w)));
    const safeBottom = Math.min(720, Math.max(bottom, ...texts.map((text) => text.y + text.h)));
    return {
      ...element,
      x,
      y,
      w: safeRight - x,
      h: safeBottom - y,
    };
  });
}

function linkContainedElements(elements: CanvasElement[]) {
  const containers = elements
    .filter((element): element is CanvasShapeElement =>
      element.type === "shape" &&
      !element.id.endsWith("-backplate") &&
      element.shape !== "line" &&
      element.w <= 1200 &&
      element.h <= 420 &&
      element.w >= 36 &&
      element.h >= 30,
    )
    .sort((left, right) => left.w * left.h - right.w * right.h);

  const assigned = elements.map((element) => {
    if (element.type !== "text") return element;
    const centerX = element.x + element.w / 2;
    const centerY = element.y + element.h / 2;
    const container = containers.find((shape) =>
      shape.id !== element.id &&
      centerX >= shape.x &&
      centerX <= shape.x + shape.w &&
      centerY >= shape.y &&
      centerY <= shape.y + shape.h,
    );
    if (!container) return element;
    const groupId = `group:${container.id}`;
    return {
      ...element,
      groupId,
      align: "center" as const,
      valign: "middle" as const,
    };
  });
  return assigned.map((element) => {
    if (element.type !== "shape") return element;
    const groupId = `group:${element.id}`;
    return assigned.some((candidate) => candidate.id !== element.id && candidate.groupId === groupId)
      ? { ...element, groupId }
      : element;
  });
}

function clampCanvasElements(elements: CanvasElement[]) {
  const canvasWidth = 1280;
  const canvasHeight = 720;
  const groupBounds = new Map<string, { x: number; y: number; right: number; bottom: number }>();

  elements.forEach((element) => {
    if (!element.groupId) return;
    const current = groupBounds.get(element.groupId);
    const next = {
      x: current ? Math.min(current.x, element.x) : element.x,
      y: current ? Math.min(current.y, element.y) : element.y,
      right: current ? Math.max(current.right, element.x + element.w) : element.x + element.w,
      bottom: current ? Math.max(current.bottom, element.y + element.h) : element.y + element.h,
    };
    groupBounds.set(element.groupId, next);
  });

  const groupOffsets = new Map<string, { dx: number; dy: number }>();
  groupBounds.forEach((bounds, groupId) => {
    const dx = Math.min(0, canvasWidth - bounds.right) + Math.max(0, -bounds.x);
    const dy = Math.min(0, canvasHeight - bounds.bottom) + Math.max(0, -bounds.y);
    groupOffsets.set(groupId, { dx, dy });
  });

  return elements.map((element) => {
    const offset = element.groupId ? groupOffsets.get(element.groupId) : undefined;
    const moved = offset ? { ...element, x: element.x + offset.dx, y: element.y + offset.dy } : element;
    return {
      ...moved,
      x: clamp(moved.x, 0, Math.max(0, canvasWidth - moved.w)),
      y: clamp(moved.y, 0, Math.max(0, canvasHeight - moved.h)),
      w: Math.min(moved.w, canvasWidth),
      h: Math.min(moved.h, canvasHeight),
    } as CanvasElement;
  });
}

export function hasCustomSlideCanvas(slide: Slide, theme: PresentationTheme, generatedCanvas = buildSlideCanvas(slide, theme)) {
  if (!slide.canvas) return false;
  if (slide.canvas.elements.some((element) => element.id === `${slide.id}-custom-canvas-marker`)) return true;
  if (isLegacySummaryStoryCanvas(slide)) return false;
  if (isLegacySummaryCanvas(slide)) return false;
  if (isLegacyFullscreenImageCanvas(slide)) return false;
  if (isLegacyTitleMiniRowCanvas(slide)) return false;
  if (isPreviousGeneratedTextLayoutCanvas(slide)) return false;
  if (sameCanvas(slide.canvas, generatedCanvas) || sameCanvasStructure(slide.canvas, generatedCanvas)) return false;
  if (sameCanvasStructure(slide.canvas, legacyGeneratedCanvas(generatedCanvas))) return false;
  if (isLegacyLeanTitleCanvas(slide)) return false;
  const imageWasEnrichedAfterCanvas = Boolean(slide.visual?.image)
    && !slide.canvas.elements.some((element) => element.type === "image")
    && generatedCanvas.elements.some((element) => element.type === "image")
    && slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id));
  if (imageWasEnrichedAfterCanvas) return false;
  if (isHistoricalGeneratedCanvas(slide, generatedCanvas)) return false;
  if ((slide.canvas.version || 1) >= 2) return true;
  return !hasAutoGeneratedCanvasMarker(slide);
}

function isHistoricalGeneratedCanvas(slide: Slide, generatedCanvas: SlideCanvas) {
  if (!slide.canvas || !slide.canvas.elements.length) return false;
  if (!slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id))) return false;

  const currentById = new Map(generatedCanvas.elements.map((element) => [element.id, element]));
  const storedIds = new Set(slide.canvas.elements.map((element) => element.id));
  if (storedIds.size !== currentById.size || [...storedIds].some((id) => !currentById.has(id))) return true;

  let changedElements = 0;
  for (const stored of slide.canvas.elements) {
    const current = currentById.get(stored.id);
    if (!current || generatedElementSignature(stored) !== generatedElementSignature(current)) changedElements += 1;
  }
  return changedElements >= 3;
}

function generatedElementSignature(element: CanvasElement) {
  const base = [element.type, element.x, element.y, element.w, element.h, element.zIndex, element.opacity];
  if (element.type === "text") return [...base, element.text, element.fontSize, element.autoFit, element.align, element.valign].join("|");
  if (element.type === "image") return [...base, element.objectKey, element.fit].join("|");
  return [...base, element.shape, element.strokeWidth].join("|");
}

function upgradeCustomCanvas(canvas: SlideCanvas, generatedCanvas: SlideCanvas, theme: PresentationTheme): SlideCanvas {
  const elements = canvas.elements
    .filter((element) => !isLegacyBackgroundElement(element.id))
    .map((element) => {
      if (element.type !== "text") return element;
      const isPlaque = /-mini-\d+$/.test(element.id);
      const fontSize = isPlaque
        ? element.fontSize === 15
          ? READABLE_PLAQUE_FONT_SIZE
          : element.fontSize
        : element.fontSize === 24
          ? READABLE_BODY_FONT_SIZE
          : element.fontSize;
      return {
        ...element,
        fontSize,
        autoFit: element.autoFit ?? false,
        h: Math.max(element.h, estimatedTextHeight(element.text, fontSize, element.w)),
        valign: element.valign || "top",
      };
    });
  return {
    ...canvas,
    background: generatedCanvas.background,
    backgroundStyle: generatedCanvas.backgroundStyle,
    elements: sortCanvasElements(linkContainedElements(addStandaloneTextBackplates(elements, theme))),
  };
}

function isLegacyBackgroundElement(id: string) {
  return /-bg(?:-|$)/.test(id) || /-bg-theme-/.test(id);
}

function hasAutoGeneratedCanvasMarker(slide: Slide) {
  if (!slide.canvas) return false;
  return slide.canvas.elements.some((element) =>
    element.id === `${slide.id}-panel` ||
    element.id === `${slide.id}-accent` ||
    element.id === `${slide.id}-bg` ||
    element.id === `${slide.id}-image-bg` ||
    element.id === `${slide.id}-title` ||
    element.id === `${slide.id}-body` ||
    element.id === `${slide.id}-bg-title-accent` ||
    element.id.startsWith(`${slide.id}-bg-`) ||
    (element.id === `${slide.id}-image` && element.type === "image" && element.x === 0 && element.y === 0 && element.w === 1280 && element.h === 720) ||
    element.id.startsWith(`${slide.id}-chip-`),
  );
}

function isLegacyFullscreenImageCanvas(slide: Slide) {
  if (!slide.canvas) return false;
  return slide.canvas.elements.some((element) =>
    element.id === `${slide.id}-image` &&
    element.type === "image" &&
    element.x === 0 &&
    element.y === 0 &&
    element.w === 1280 &&
    element.h === 720,
  );
}

function isLegacyLeanTitleCanvas(slide: Slide) {
  if (!slide.canvas || slide.slideKind !== "title") return false;
  const elementIds = slide.canvas.elements.map((element) => element.id);
  if (elementIds.some((id) => id.includes("-panel") || id.includes("-mini-"))) return false;
  if (!slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id))) return false;

  const title = slide.canvas.elements.find((element) => element.id === `${slide.id}-title`);
  const body = slide.canvas.elements.find((element) => element.id === `${slide.id}-body`);
  return (
    title?.type === "text" &&
    body?.type === "text" &&
    title.text === slide.title &&
    title.x === 112 &&
    title.y === 206 &&
    title.w === 1056 &&
    title.h === 116 &&
    body.x === 158 &&
    body.y === 346 &&
    body.w === 964 &&
    body.h === 120
  );
}

function isLegacyTitleMiniRowCanvas(slide: Slide) {
  if (!slide.canvas || slide.slideKind !== "title") return false;
  if (!slide.canvas.elements.some((element) => element.id === `${slide.id}-mini-0-shape`)) return false;
  if (!slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id))) return false;

  const title = slide.canvas.elements.find((element) => element.id === `${slide.id}-title`);
  const body = slide.canvas.elements.find((element) => element.id === `${slide.id}-body`);
  const miniShapes = slide.canvas.elements
    .filter((element): element is CanvasShapeElement =>
      element.type === "shape" && new RegExp(`^${escapeRegExp(slide.id)}-mini-\\d+-shape$`).test(element.id),
    )
    .sort((left, right) => left.x - right.x);

  return (
    title?.type === "text" &&
    body?.type === "text" &&
    title.text === slide.title &&
    title.x === 178 &&
    title.y === 188 &&
    title.w === 924 &&
    title.h === 148 &&
    body.x === 210 &&
    body.y === 356 &&
    body.w === 860 &&
    body.h >= 112 &&
    miniShapes.length > 0 &&
    miniShapes.every((shape) => shape.y === 512) &&
    miniShapes.slice(1).every((shape, index) => miniShapes[index].x + miniShapes[index].w < shape.x)
  );
}

function isLegacySummaryCanvas(slide: Slide) {
  if (!slide.canvas || slide.slideKind !== "summary") return false;
  const summaryPrefix = `${slide.id}-summary-`;
  const items = sequenceItems(slide).slice(0, 6);
  const columns = items.length > 3 ? 3 : Math.max(items.length, 1);
  const cardWidth = 340;
  const gap = 24;
  const startX = (1280 - columns * cardWidth - (columns - 1) * gap) / 2;

  const matchesLegacyGeometry = items.every((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * (cardWidth + gap);
    const y = 176 + row * 148;
    const card = slide.canvas!.elements.find((element) => element.id === `${summaryPrefix}${index}-card`);
    const number = slide.canvas!.elements.find((element) => element.id === `${summaryPrefix}${index}-num`);
    const text = slide.canvas!.elements.find((element) => element.id === `${summaryPrefix}${index}`);
    return (
      card?.type === "shape" &&
      card.x === x &&
      card.y === y &&
      card.w === cardWidth &&
      card.h === 118 &&
      number?.type === "text" &&
      number.text === String(index + 1) &&
      number.x === x + 16 &&
      number.y === y + 25 &&
      text?.type === "text" &&
      text.text === item &&
      text.x === x + 66 &&
      text.y === y + 18 &&
      text.w === cardWidth - 86 &&
      text.h === 78
    );
  });
  if (!items.length || !matchesLegacyGeometry) return false;

  return slide.canvas.elements.every((element) => {
    const id = element.id.endsWith("-backplate") ? element.id.slice(0, -"-backplate".length) : element.id;
    return (
      id === `${slide.id}-custom-canvas-marker` ||
      id === `${slide.id}-title` ||
      id === `${slide.id}-image` ||
      new RegExp(`^${escapeRegExp(summaryPrefix)}\\d+(?:-card|-num-bg|-num)?$`).test(id)
    );
  });
}

function isLegacySummaryStoryCanvas(slide: Slide) {
  if (!slide.canvas || slide.slideKind !== "summary") return false;
  if (!slide.canvas.elements.some((element) => element.id === `${slide.id}-summary-conclusion`)) return false;
  const generatedOnly = slide.canvas.elements.every((element) =>
    element.id === `${slide.id}-custom-canvas-marker` || isKnownGeneratedCanvasElementId(slide.id, element.id),
  );
  if (!generatedOnly) return false;

  const supportLabel = slide.canvas.elements.find((element) => element.id === `${slide.id}-summary-support-label`);
  const finalLabel = slide.canvas.elements.find((element) => element.id === `${slide.id}-summary-final-label`);
  return (
    (supportLabel?.type === "text" && supportLabel.fontSize < READABLE_PLAQUE_FONT_SIZE) ||
    (finalLabel?.type === "text" && finalLabel.fontSize < READABLE_PLAQUE_FONT_SIZE)
  );
}

function isPreviousGeneratedTextLayoutCanvas(slide: Slide) {
  if (!slide.canvas) return false;
  if (!slide.canvas.elements.every((element) => isKnownGeneratedCanvasElementId(slide.id, element.id))) return false;

  const title = slide.canvas.elements.find((element) => element.id === `${slide.id}-title`);
  if (title?.type !== "text" || title.text !== slide.title) return false;

  if (slide.slideKind === "summary") {
    const conclusion = slide.canvas.elements.find((element) => element.id === `${slide.id}-summary-conclusion`);
    return conclusion?.type === "text" && conclusion.y === 184 && conclusion.w === 640 && conclusion.h === 270;
  }

  const body = slide.canvas.elements.find((element) => element.id === `${slide.id}-body`);
  const bodyText = slide.thesis || slideBodyText(slide);
  if (body?.type !== "text" || body.text !== bodyText || body.autoFit !== undefined) return false;

  const previousTitleGrid = slide.slideKind === "title"
    && title.x === 178 && title.y === 118 && title.w === 924 && title.h === 148
    && body.x === 210 && body.y === 282 && body.w === 860 && body.h >= 112;
  const previousPremiumHero = slide.slideKind === "title"
    && slide.canvas.elements.some((element) => element.id.startsWith(`${slide.id}-premium-`))
    && ((body.x === 156 && body.y === 364 && body.w === 968) || (body.x === 86 && body.y === 372 && body.w === 720));
  const previousImageFocus = slide.layout === "image-focus"
    && body.x === 79 && body.y === 192 && body.w === 504 && body.h >= 230;
  const previousPremiumImageFocus = slide.layout === "image-focus"
    && slide.canvas.elements.some((element) => element.id.startsWith(`${slide.id}-premium-`))
    && title.x === 84 && title.y === 154 && title.w === 560
    && body.x === 84 && body.y === 310 && body.w === 548 && body.h >= 148;

  return previousTitleGrid || previousPremiumHero || previousImageFocus || previousPremiumImageFocus;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isKnownGeneratedCanvasElementId(slideId: string, elementId: string) {
  if (elementId.endsWith("-backplate")) {
    return isKnownGeneratedCanvasElementId(slideId, elementId.slice(0, -"-backplate".length));
  }
  if (
    elementId === `${slideId}-bg` ||
    elementId === `${slideId}-accent` ||
    elementId === `${slideId}-panel` ||
    elementId === `${slideId}-title` ||
    elementId === `${slideId}-body` ||
    elementId === `${slideId}-image` ||
    elementId === `${slideId}-image-bg` ||
    elementId === `${slideId}-image-caption`
  ) {
    return true;
  }

  return (
    elementId.startsWith(`${slideId}-bg-`) ||
    elementId.startsWith(`${slideId}-chip-`) ||
    elementId.startsWith(`${slideId}-statement`) ||
    elementId.startsWith(`${slideId}-quote`) ||
    elementId.startsWith(`${slideId}-definition`) ||
    elementId.startsWith(`${slideId}-sequence`) ||
    elementId.startsWith(`${slideId}-step-`) ||
    elementId.startsWith(`${slideId}-comparison-`) ||
    elementId.startsWith(`${slideId}-panel-`) ||
    elementId.startsWith(`${slideId}-answer-`) ||
    elementId.startsWith(`${slideId}-myth-`) ||
    elementId.startsWith(`${slideId}-seq-`) ||
    elementId.startsWith(`${slideId}-left-`) ||
    elementId.startsWith(`${slideId}-right-`) ||
    elementId.startsWith(`${slideId}-qa-`) ||
    elementId.startsWith(`${slideId}-metric-`) ||
    elementId.startsWith(`${slideId}-evidence-`) ||
    elementId.startsWith(`${slideId}-source-`) ||
    elementId.startsWith(`${slideId}-problem-`) ||
    elementId.startsWith(`${slideId}-explain-`) ||
    elementId.startsWith(`${slideId}-summary-`) ||
    elementId.startsWith(`${slideId}-mini-`) ||
    elementId.startsWith(`${slideId}-card-`) ||
    elementId.startsWith(`${slideId}-premium-`) ||
    elementId.startsWith(`${slideId}-visual-`)
  );
}

function legacyGeneratedCanvas(canvas: SlideCanvas): SlideCanvas {
  return {
    ...canvas,
    elements: canvas.elements
      .filter((element) => !element.id.endsWith("-backplate"))
      .map((element) => {
        if (element.id.includes("-mini-") && element.type === "shape") {
          return { ...element, h: 50 };
        }
        if (element.id.includes("-mini-") && element.type === "text") {
          return { ...element, h: 36 };
        }
        return element;
      }),
  };
}

function sameCanvas(left: SlideCanvas, right: SlideCanvas) {
  return JSON.stringify(normalizeCanvasForComparison(left)) === JSON.stringify(normalizeCanvasForComparison(right));
}

function normalizeCanvasForComparison(canvas: SlideCanvas) {
  return {
    ...canvas,
    elements: sortCanvasElements(canvas.elements),
  };
}

function sameCanvasStructure(left: SlideCanvas, right: SlideCanvas) {
  return JSON.stringify(normalizeCanvasStructureForComparison(left)) === JSON.stringify(normalizeCanvasStructureForComparison(right));
}

function normalizeCanvasStructureForComparison(canvas: SlideCanvas) {
  return {
    width: canvas.width,
    height: canvas.height,
    elements: sortCanvasElements(canvas.elements).map((element) => {
      const rest: Record<string, unknown> = { ...element };
      delete rest.fill;
      delete rest.stroke;
      delete rest.color;
      delete rest.background;
      delete rest.opacity;
      return rest;
    }),
  };
}

function backgroundElements(slide: Slide, theme: PresentationTheme): CanvasElement[] {
  void slide;
  void theme;
  return [];
}

function addDefaultContentCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const image = slide.visual?.image;
  const hasImage = Boolean(image);
  // Default content is a claim-led fallback.  Do not concatenate bullets and
  // mirrored blocks here: that creates a paragraph wall before typography can
  // help.  Richer detail stays in the dedicated layouts and speaker notes.
  const body = [slide.visual?.title, slide.thesis || slideBodyText(slide)].filter(Boolean).join("\n\n");
  elements.push(
    textElement(`${slide.id}-title`, slide.title, hasImage ? 78 : 101, 56, hasImage ? 528 : 1075, hasImage ? 104 : 112, 4, {
      role: "title",
      fontSize: fittedFontSize(slide.title, hasImage ? 38 : 46, 28, hasImage ? 104 : 112),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      align: hasImage ? "left" : "center",
    }),
    textElement(`${slide.id}-body`, body, hasImage ? 78 : 144, hasImage ? 197 : 300, hasImage ? 514 : 992, hasImage ? 336 : 160, 4, {
      role: "body",
      fontSize: fittedFontSize(body, hasImage ? READABLE_BODY_FONT_SIZE : 26, MIN_GENERATED_BODY_FONT_SIZE, hasImage ? 336 : 160),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
      align: hasImage ? "left" : "center",
    }),
  );
  if (image) {
    elements.push(imageElement(`${slide.id}-image`, image, 645, 65, 566, 562, 3, 1, imageFitForVisual(slide)));
  }
}

function addStatementCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements, { centered: true, fontSize: 42 });
  const statement = compactSummaryPoint(slide.thesis || slideBodyText(slide), 20) || slide.thesis || slideBodyText(slide);
  elements.push(
    textElement(`${slide.id}-statement`, statement, 130, 196, 1018, 274, 4, {
      role: "body",
      fontSize: fittedFontSize(statement, 40, 25, 274),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      align: "center",
    }),
  );
  addMiniPointRow(slide, theme, elements, 296, 544);
}

function addQuoteCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  elements.push(
    textElement(`${slide.id}-quote-mark`, "“", 68, 190, 64, 88, 4, {
      role: "caption",
      fontSize: 74,
      fontFamily: theme.fonts.heading,
      color: theme.colors.accent,
      bold: true,
      align: "center",
    }),
    textElement(`${slide.id}-quote`, quoteText(slide), 154, 188, 972, 250, 4, {
      role: "body",
      fontSize: fittedFontSize(quoteText(slide), 36, 23, 250),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
      italic: true,
      align: "center",
    }),
  );
  const bullets = slide.bullets || [];
  if (bullets[0]) {
    elements.push(textElement(`${slide.id}-quote-note`, bullets[0], 202, 466, 876, 60, 4, {
      role: "caption",
      fontSize: 20,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
      align: "center",
    }));
  }
}

function addDefinitionCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const definition = slide.definition || { term: slide.title, text: slide.thesis || slideBodyText(slide) };
  elements.push(
    shapeElement(`${slide.id}-definition-card`, "roundRect", 86, 164, 1109, 331, 2, theme.colors.surfaceAlt, theme.colors.line, 1, 1),
    textElement(`${slide.id}-definition-term`, definition.term, 120, 194, 1038, 80, 4, {
      role: "title",
      fontSize: 38,
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-definition-text`, definition.text, 120, 293, 1038, 130, 4, {
      role: "body",
      fontSize: fittedFontSize(definition.text, READABLE_BODY_FONT_SIZE, MIN_GENERATED_BODY_FONT_SIZE, 130),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
}

function addSequenceCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  if (slide.thesis) {
    elements.push(textElement(`${slide.id}-kicker`, slide.thesis, 78, 188, 1124, 64, 4, {
      role: "body",
      fontSize: MIN_GENERATED_BODY_FONT_SIZE,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }));
  }
  const detailedItems = slide.visual.items.filter((item) => item.label || item.text).slice(0, 5);
  const items = detailedItems.length
    ? detailedItems
    : sequenceItems(slide).slice(0, 5).map((text, index) => ({ label: `Шаг ${index + 1}`, text }));
  const width = 1123 / Math.max(items.length, 1);
  elements.push(shapeElement(`${slide.id}-sequence-line`, "rect", 100, 300, 1076, 4, 2, theme.colors.line, theme.colors.line, 0, 1));
  items.forEach((item, index) => {
    const x = 79 + index * width;
    const bodyWidth = width - 52;
    const bodyFontSize = bodyWidth >= 480 ? MIN_GENERATED_BODY_FONT_SIZE : 18;
    const bodyText = sentencePreview(item.text || item.label, bodyWidth >= 480 ? 86 : 62);
    const bodyHeight = Math.max(104, estimatedTextHeight(bodyText, bodyFontSize, bodyWidth));
    elements.push(
      shapeElement(`${slide.id}-step-${index}-num-bg`, "ellipse", x + 18, 280, 43, 43, 3, theme.colors.text, theme.colors.text, 0, 1),
      textElement(`${slide.id}-step-${index}-num`, String(index + 1), x + 18, 288, 43, 24, 4, {
        role: "caption",
        fontSize: 16,
        fontFamily: theme.fonts.body,
        color: theme.colors.background,
        bold: true,
        align: "center",
      }),
      textElement(`${slide.id}-step-${index}-label`, item.label, x + 18, 344, width - 52, 46, 4, {
        role: "caption",
        fontSize: 18,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
      }),
      textElement(`${slide.id}-step-${index}`, bodyText, x + 18, 414, bodyWidth, bodyHeight, 4, {
        role: "body",
        fontSize: bodyFontSize,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addComparisonCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const rows = comparisonRows(slide).slice(0, 3);
  const leftLabel = slide.visual?.leftLabel || "Первое";
  const rightLabel = slide.visual?.rightLabel || "Второе";
  elements.push(
    textElement(`${slide.id}-comparison-criterion-label`, "Критерий", 86, 196, 222, 42, 4, labelText(theme)),
    textElement(`${slide.id}-comparison-left-label`, leftLabel, 329, 196, 420, 42, 4, labelText(theme)),
    textElement(`${slide.id}-comparison-right-label`, rightLabel, 770, 196, 425, 42, 4, labelText(theme)),
  );
  rows.forEach((row, index) => {
    const y = 248 + index * 126;
    addComparisonCell(slide, theme, elements, `criterion-${index}`, 86, y, row.label || `Критерий ${index + 1}`, 222);
    addComparisonCell(slide, theme, elements, `left-${index}`, 329, y, row.left || row.label, 420);
    addComparisonCell(slide, theme, elements, `right-${index}`, 770, y, row.right || row.label, 425);
  });
}

function addImageFocusCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const image = slide.visual?.image;
  const bodyText = slide.thesis || slideBodyText(slide);
  const bodyY = 200;
  const bodyHeight = Math.max(230, estimatedTextHeight(bodyText, READABLE_BODY_FONT_SIZE, 504));
  addSlideTitle(slide, theme, elements, { width: 528, fontSize: 38 });
  elements.push(textElement(`${slide.id}-body`, bodyText, 79, bodyY, 504, bodyHeight, 4, {
    role: "body",
    fontSize: READABLE_BODY_FONT_SIZE,
    autoFit: false,
    fontFamily: theme.fonts.body,
    color: theme.colors.muted,
  }));
  if (image) elements.push(imageElement(`${slide.id}-image`, image, 638, 69, 571, 552, 3, 1, imageFitForVisual(slide)));
  addMiniPointRow(slide, theme, elements, 79, Math.max(520, bodyY + bodyHeight + 36), { rightBoundary: 610, maxBottom: 680 });
}

function addSummaryCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = sequenceItems(slide).slice(0, 5);
  // The conclusion is the slide's canonical main claim.  Keep it intact:
  // shortening belongs to the supporting rail, not to the final takeaway.
  const mainConclusion = slide.thesis || items[0] || slideBodyText(slide);
  // The summary sidebar is a one-line visual index; the full supporting
  // propositions remain in Slide.bullets and the narration.
  const supportingItems = items.filter((item) => item !== mainConclusion).slice(0, 3).map((item) => compactSummaryPoint(item, 1));
  const finalThoughtSource = items.filter((item) => item !== mainConclusion).slice(3, 4)[0];
  const finalThought = finalThoughtSource ? compactSummaryPoint(finalThoughtSource, 14) : "";
  const conclusionFontSize = fittedFontSize(mainConclusion, 44, 25, 230);
  // `summary-conclusion` is a main-claim typography slot (44px minimum), so
  // reserve the full vertical field before considering any bounded fitting.
  // Measuring it as generic body copy would under-allocate tall Cyrillic text.
  const conclusionHeight = 270;

  elements.push(
    textElement(`${slide.id}-summary-conclusion`, mainConclusion, 70, 196, 640, conclusionHeight, 4, {
      role: "body",
      fontSize: conclusionFontSize,
      autoFit: false,
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    shapeElement(`${slide.id}-summary-accent`, "rect", 70, 490, 640, 5, 3, theme.colors.accent, theme.colors.accent, 0, 1),
  );

  if (supportingItems.length) {
    elements.push(
      textElement(`${slide.id}-summary-support-label`, "Ключевые мысли", 790, 200, 398, 34, 4, {
        role: "caption",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
      }),
    );
  }

  let supportY = 264;
  let supportBottom = supportY;
  supportingItems.forEach((item, index) => {
    const itemHeight = Math.min(110, Math.max(55, estimatedTextHeight(item, READABLE_PLAQUE_FONT_SIZE, 362)));
    const y = supportY;
    elements.push(
      shapeElement(`${slide.id}-summary-support-${index}-dot`, "ellipse", 792, y + 8, 12, 12, 3, theme.colors.accentAlt, theme.colors.accentAlt, 0, 1),
      textElement(`${slide.id}-summary-support-${index}`, item, 826, y, 362, itemHeight, 4, {
        role: "body",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
    supportBottom = y + itemHeight + PLAQUE_PADDING_Y;
    supportY += itemHeight + 48;
  });

  const finalThoughtY = Math.max(536, supportBottom + 12);
  if (finalThought && finalThoughtY + 112 <= 696) {
    elements.push(
      shapeElement(`${slide.id}-summary-final-bg`, "roundRect", 70, finalThoughtY, 1140, 112, 2, theme.colors.surfaceAlt, theme.colors.line, 1, 0.92),
      textElement(`${slide.id}-summary-final-label`, "Что стоит запомнить", 94, finalThoughtY + 22, 270, 68, 4, {
        role: "caption",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.heading,
        color: theme.colors.text,
        bold: true,
        valign: "middle",
      }),
      textElement(`${slide.id}-summary-final`, finalThought, 390, finalThoughtY + 18, 790, 76, 4, {
        role: "body",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
        valign: "middle",
      }),
    );
  }
}

function addPanelGridCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], labels: string[]) {
  addSlideTitle(slide, theme, elements);
  const items = uniqueCanvasItems(sequenceItems(slide)).slice(0, Math.max(1, labels.length));
  const count = Math.max(1, items.length);
  const gap = 22;
  const availableWidth = count === 1 ? 860 : 1104;
  const width = (availableWidth - gap * (count - 1)) / count;
  const startX = (1280 - availableWidth) / 2;
  items.forEach((item, index) => {
    const x = startX + index * (width + gap);
    const value = compactSummaryPoint(item, count >= 3 ? 14 : 18) || item;
    elements.push(
      shapeElement(`${slide.id}-panel-${index}`, "roundRect", x, 192, width, 286, 2, index % 2 ? theme.colors.surface : theme.colors.surfaceAlt, theme.colors.line, 1, 1),
      textElement(`${slide.id}-panel-${index}-label`, labels[index] || String(index + 1).padStart(2, "0"), x + 24, 218, width - 48, 36, 4, {
        ...labelText(theme),
        fontSize: MIN_GENERATED_CAPTION_FONT_SIZE,
      }),
      textElement(`${slide.id}-panel-${index}-text`, value, x + 24, 278, width - 48, 154, 4, {
        role: "body",
        fontSize: MIN_GENERATED_BODY_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addQuestionAnswerCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements, { centered: true, fontSize: 42 });
  elements.push(
    shapeElement(`${slide.id}-answer-card`, "roundRect", 149, 204, 979, 211, 2, theme.colors.surfaceAlt, theme.colors.line, 1, 1),
    textElement(`${slide.id}-answer-label`, "Ответ", 187, 228, 902, 32, 4, labelText(theme)),
    textElement(`${slide.id}-answer-text`, compactSummaryPoint(slide.thesis || slideBodyText(slide), 12) || slide.thesis || slideBodyText(slide), 187, 283, 902, 82, 4, {
      role: "body",
      fontSize: READABLE_BODY_FONT_SIZE,
      autoFit: false,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
  slide.bullets.slice(0, 3).forEach((item, index) => {
    const x = 149 + index * 333;
    elements.push(
      shapeElement(`${slide.id}-answer-support-${index}-card`, "roundRect", x - 12, 450, 318, 142, 2, theme.colors.surface, theme.colors.line, 1, 0.94),
    );
    elements.push(
      textElement(`${slide.id}-answer-support-${index}-label`, ["Почему", "Пример", "Что это меняет"][index], x, 464, 294, 28, 4, labelText(theme)),
      textElement(`${slide.id}-answer-support-${index}`, compactSummaryPoint(item, 7) || item, x, 501, 294, 76, 4, {
        role: "body",
        typographyRole: "supporting",
        fontSize: presentationTypography.supporting.preferredPx,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addMythFactCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = slide.visual.items.slice(0, 2);
  const fallback = sequenceItems(slide);
  const content = [0, 1].map((index) => {
    const item = items[index];
    return item ? [item.label, item.text].filter(Boolean).join(". ") : fallback[index] || slide.thesis;
  });

  ["Миф", "Факт"].forEach((label, index) => {
    const x = 88 + index * 552;
    elements.push(
      shapeElement(`${slide.id}-myth-fact-${index}`, "roundRect", x, 178, 534, 208, 2, index ? theme.colors.surface : theme.colors.surfaceAlt, theme.colors.line, 1, 1),
      textElement(`${slide.id}-myth-fact-${index}-label`, label, x + 24, 203, 486, 34, 4, labelText(theme)),
      textElement(`${slide.id}-myth-fact-${index}-text`, content[index], x + 24, 255, 486, 94, 4, {
        role: "body",
        fontSize: 18,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });

  slide.bullets.slice(0, 2).forEach((item, index) => {
    const x = 88 + index * 552;
    elements.push(
      textElement(`${slide.id}-myth-context-${index}-label`, index ? "Проверка" : "Почему в это верят", x, 420, 534, 30, 4, labelText(theme)),
      textElement(`${slide.id}-myth-context-${index}`, item, x, 482, 534, 82, 4, {
        role: "body",
        fontSize: 16,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addMetricsCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  const items = sequenceItems(slide).filter(hasMeasurableValue).slice(0, 4);
  if (!items.length) {
    addStatementCanvas(slide, theme, elements);
    return;
  }
  addSlideTitle(slide, theme, elements);
  items.forEach((item, index) => {
    const x = 86 + index * 288;
    elements.push(
      shapeElement(`${slide.id}-metric-${index}-card`, "roundRect", x, 192, 261, 226, 2, theme.colors.surface, theme.colors.line, 1, 1),
      textElement(`${slide.id}-metric-${index}-lead`, metricLead(item), x + 17, 219, 226, 54, 4, {
        role: "title",
        fontSize: 38,
        fontFamily: theme.fonts.heading,
        color: theme.colors.accentAlt,
        bold: true,
      }),
      textElement(`${slide.id}-metric-${index}-text`, item, x + 17, 296, 226, 76, 4, {
        role: "body",
        fontSize: 16,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addEvidenceCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const thesis = compactSummaryPoint(slide.thesis || slideBodyText(slide), 14) || sentencePreview(slide.thesis || slideBodyText(slide), 180);
  const evidence = sequenceItems(slide).filter((item) => !isDuplicateCanvasText(item, thesis)).slice(0, 4);
  elements.push(
    textElement(`${slide.id}-evidence-thesis`, thesis, 86, 196, 1108, 104, 4, {
      role: "body",
      fontSize: fittedFontSize(thesis, 34, 25, 105),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    shapeElement(`${slide.id}-evidence-divider`, "rect", 86, 320, 1108, 3, 2, theme.colors.accent, theme.colors.accent, 0, 1),
  );
  evidence.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 86 + column * 560;
    const y = 348 + row * 104;
    elements.push(
      shapeElement(`${slide.id}-evidence-${index}-dot`, "ellipse", x, y + 4, 28, 28, 3, theme.colors.accentAlt, theme.colors.accentAlt, 0, 1),
      textElement(`${slide.id}-evidence-${index}`, item, x + 44, y, 500, 72, 4, {
        role: "body",
        fontSize: fittedFontSize(item, 24, MIN_GENERATED_BODY_FONT_SIZE, 72),
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addProblemSolutionCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = sequenceItems(slide);
  const labels = ["Проблема", "Причина", "Решение"];
  labels.forEach((label, index) => {
    const x = 86 + index * 370;
    const value = items[index] || slide.thesis || slideBodyText(slide);
    elements.push(
      textElement(`${slide.id}-problem-${index}-label`, label, x, 180, 330, 34, 4, labelText(theme)),
      shapeElement(`${slide.id}-problem-${index}-line`, "rect", x, 229, 330, 3, 2, index === 2 ? theme.colors.accentAlt : theme.colors.line, theme.colors.line, 0, 1),
      textElement(`${slide.id}-problem-${index}-text`, value, x, 258, 330, 190, 4, {
        role: "body",
        fontSize: fittedFontSize(value, 21, 16, 190),
        fontFamily: theme.fonts.body,
        color: theme.colors.muted,
      }),
    );
  });
}

function addExplainExampleCanvas(slide: Slide, theme: PresentationTheme, elements: CanvasElement[]) {
  addSlideTitle(slide, theme, elements);
  const items = sequenceItems(slide);
  const definition = slide.definition || { term: slide.title, text: slide.thesis || items[0] || slideBodyText(slide) };
  const example = items[1] || items[0] || slide.thesis;
  const caveat = items[2] || slide.bullets[1] || "Пример помогает понять идею, но не заменяет её точное определение.";
  elements.push(
    textElement(`${slide.id}-explain-term`, definition.term, 86, 192, 416, 72, 4, {
      role: "title",
      fontSize: fittedFontSize(definition.term, 35, 25, 72),
      fontFamily: theme.fonts.heading,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-explain-definition`, definition.text, 86, 284, 416, 168, 4, {
      role: "body",
      fontSize: fittedFontSize(definition.text, 23, 17, 168),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
    shapeElement(`${slide.id}-explain-divider`, "rect", 548, 192, 3, 358, 2, theme.colors.line, theme.colors.line, 0, 1),
    textElement(`${slide.id}-explain-example-label`, "Пример", 596, 192, 564, 34, 4, labelText(theme)),
    textElement(`${slide.id}-explain-example`, example, 596, 248, 564, 126, 4, {
      role: "body",
      fontSize: fittedFontSize(example, 22, 17, 126),
      fontFamily: theme.fonts.body,
      color: theme.colors.text,
      bold: true,
    }),
    textElement(`${slide.id}-explain-caveat-label`, "Важно помнить", 596, 404, 564, 34, 4, labelText(theme)),
    textElement(`${slide.id}-explain-caveat`, caveat, 596, 460, 564, 82, 4, {
      role: "body",
      fontSize: fittedFontSize(caveat, 17, 14, 82),
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
}

function addSlideAttributionCanvas(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  color = theme.colors.muted,
) {
  if (elements.some((element) => element.type === "text" && element.typographyRole === "sourceCredit")) return;
  const attribution = formatSlideAttribution(slide.sourceRefs, slide.visual.image);
  if (!attribution) return;
  const editorialFooterOrder = elements.find((element) => element.type === "text" && element.id.endsWith("-editorial-footer-order"));
  const editorialFooterLine = elements.find((element) => element.type === "shape" && element.id.endsWith("-editorial-footer-line"));
  const x = editorialFooterLine?.x ?? 72;
  const width = editorialFooterOrder
    ? Math.max(120, editorialFooterOrder.x - x - 24)
    : editorialFooterLine?.w ?? 1136;
  elements.push(textElement(`${slide.id}-source-credit`, attribution, x, 684, width, 20, 12, {
    role: "caption",
    typographyRole: "sourceCredit",
    fontSize: presentationTypography.sourceCredit.preferredPx,
    autoFit: false,
    fontFamily: theme.fonts.body,
    color,
    align: "left",
    valign: "middle",
  }));
}

function addFallbackImageCanvas(slide: Slide, elements: CanvasElement[]) {
  if (slide.slideKind === "summary") return;
  const image = slide.visual?.image;
  if (!image) return;
  if (elements.some((element) => element.type === "image")) return;
  const candidate = imageElement(`${slide.id}-image`, image, 840, 180, 340, 362, 3, 0.94, "contain");
  if (elements.some((element) => element.type === "text" && elementsVisuallyOverlap(element, candidate))) return;
  elements.push(candidate);
}

function addSlideTitle(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  options: { centered?: boolean; width?: number; fontSize?: number } = {},
) {
  elements.push(textElement(`${slide.id}-title`, slide.title, options.centered ? 101 : 69, 56, options.width || (options.centered ? 1075 : 1142), 104, 4, {
    role: "title",
    fontSize: fittedFontSize(slide.title, options.fontSize || 40, 27, 104),
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    bold: true,
    align: options.centered ? "center" : "left",
  }));
}

function addMiniPointRow(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  x: number,
  y: number,
  options: { rightBoundary?: number; maxBottom?: number } = {},
) {
  const labels = uniqueCanvasItems((slide.bullets || []).slice(0, 3).map((item, index) => miniChipText(item, slide, index)));
  if (!labels.length) return;
  const gap = 18;
  const rightBoundary = options.rightBoundary || 1232;
  const desiredWidths = labels.map((label) => plaqueWidth(label, READABLE_PLAQUE_FONT_SIZE));
  const desiredWidth = desiredWidths.reduce((total, width) => total + width, 0) + gap * Math.max(0, desiredWidths.length - 1);
  const availableWidth = rightBoundary - x;
  const fittedWidth = desiredWidth > availableWidth
    ? Math.max(150, Math.floor((availableWidth - gap * Math.max(0, labels.length - 1)) / labels.length))
    : 0;
  const widths = desiredWidths.map((width) => fittedWidth || width);
  const rowHeight = Math.max(...labels.map((label, index) => plaqueHeight(label, READABLE_PLAQUE_FONT_SIZE, widths[index] - PLAQUE_PADDING_X * 2)));
  if (y + rowHeight > (options.maxBottom || 680)) return;
  let chipX = x;

  labels.forEach((label, index) => {
    const chipWidth = widths[index];
    const textWidth = chipWidth - PLAQUE_PADDING_X * 2;
    elements.push(
      shapeElement(`${slide.id}-mini-${index}-shape`, "roundRect", chipX, y, chipWidth, rowHeight, 3, theme.colors.surface, theme.colors.accent, 1, 1),
      textElement(`${slide.id}-mini-${index}`, label, chipX + PLAQUE_PADDING_X, y + PLAQUE_PADDING_Y, textWidth, rowHeight - PLAQUE_PADDING_Y * 2, 4, {
        role: "caption",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.text,
        bold: true,
        align: "center",
      }),
    );
    chipX += chipWidth + gap;
  });
}

function addTitleMiniPointGrid(slide: Slide, theme: PresentationTheme, elements: CanvasElement[], topY = 430) {
  const labels = uniqueCanvasItems((slide.bullets || []).slice(0, 3).map((item, index) => miniChipText(item, slide, index)));
  if (!labels.length) return;

  const gap = 18;
  const columnWidth = 280;
  const rowWidth = labels.length === 1 ? 538 : columnWidth * 2 + gap;
  const topHeights = labels.slice(0, 2).map((label) => plaqueHeight(label, READABLE_PLAQUE_FONT_SIZE, columnWidth - PLAQUE_PADDING_X * 2));
  const topHeight = Math.max(...topHeights);
  const bottomHeight = labels.length === 3
    ? plaqueHeight(labels[2], READABLE_PLAQUE_FONT_SIZE, rowWidth - PLAQUE_PADDING_X * 2)
    : 0;
  const gridBottom = topY + topHeight + (labels.length === 3 ? gap + bottomHeight : 0);
  const useSingleRow = labels.length === 3 && gridBottom > 680;
  const singleRowWidth = 280;
  const singleRowHeight = useSingleRow
    ? Math.max(...labels.map((label) => plaqueHeight(label, READABLE_PLAQUE_FONT_SIZE, singleRowWidth - PLAQUE_PADDING_X * 2)))
    : 0;
  if (!useSingleRow && gridBottom > CANVAS_SAFE_BOTTOM) return;
  if (useSingleRow && topY + singleRowHeight > 680) return;
  const effectiveRowWidth = useSingleRow ? labels.length * singleRowWidth + gap * (labels.length - 1) : rowWidth;
  const startX = (1280 - effectiveRowWidth) / 2;

  labels.forEach((label, index) => {
    const isSingleBottom = !useSingleRow && labels.length === 3 && index === 2;
    const chipWidth = isSingleBottom || labels.length === 1 ? rowWidth : columnWidth;
    const chipX = isSingleBottom || labels.length === 1 ? startX : startX + index * ((useSingleRow ? singleRowWidth : columnWidth) + gap);
    const chipY = isSingleBottom ? topY + topHeight + gap : topY;
    const textWidth = chipWidth - PLAQUE_PADDING_X * 2;
    const chipHeight = useSingleRow ? singleRowHeight : plaqueHeight(label, READABLE_PLAQUE_FONT_SIZE, textWidth);
    elements.push(
      shapeElement(`${slide.id}-mini-${index}-shape`, "roundRect", chipX, chipY, chipWidth, chipHeight, 3, theme.colors.surface, theme.colors.accent, 1, 1),
      textElement(`${slide.id}-mini-${index}`, label, chipX + PLAQUE_PADDING_X, chipY + PLAQUE_PADDING_Y, textWidth, chipHeight - PLAQUE_PADDING_Y * 2, 4, {
        role: "caption",
        fontSize: READABLE_PLAQUE_FONT_SIZE,
        autoFit: false,
        fontFamily: theme.fonts.body,
        color: theme.colors.text,
        bold: true,
        align: "center",
        valign: "middle",
      }),
    );
  });
}

function addComparisonCell(
  slide: Slide,
  theme: PresentationTheme,
  elements: CanvasElement[],
  id: string,
  x: number,
  y: number,
  value: string,
  width = 533,
) {
  // Narrow criterion cells are labels, not miniature paragraphs.  Keep them
  // to one compact thought before relying on the fixed presentation font.
  const compactValue = compactSummaryPoint(value, width < 300 ? 2 : 14) || value;
  elements.push(
    shapeElement(`${slide.id}-comparison-${id}-card`, "roundRect", x, y, width, 108, 2, theme.colors.surface, theme.colors.line, 1, 1),
    textElement(`${slide.id}-comparison-${id}-text`, compactValue, x + 19, y + 16, width - 38, 76, 4, {
      role: "body",
      fontSize: MIN_GENERATED_BODY_FONT_SIZE,
      autoFit: false,
      fontFamily: theme.fonts.body,
      color: theme.colors.muted,
    }),
  );
}

function labelText(theme: PresentationTheme): Partial<CanvasTextElement> {
  return {
    role: "caption",
    fontSize: MIN_GENERATED_CAPTION_FONT_SIZE,
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    bold: true,
  };
}

function shapeElement(
  id: string,
  shape: CanvasShapeElement["shape"],
  x: number,
  y: number,
  w: number,
  h: number,
  zIndex: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  opacity = 1,
  locked = false,
): CanvasShapeElement {
  const fallbackFill = fill === "transparent" ? "#FFFFFF" : fill;
  const fallbackStroke = stroke === "transparent" ? fallbackFill : stroke;
  return {
    id,
    type: "shape",
    shape,
    x,
    y,
    w,
    h,
    rotation: 0,
    zIndex,
    opacity,
    locked,
    fill: fallbackFill,
    stroke: fallbackStroke,
    strokeWidth,
  };
}

function textElement(
  id: string,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  zIndex: number,
  options: Partial<CanvasTextElement>,
): CanvasTextElement {
  const text = cleanCanvasText(value);
  return fitCanvasTextElement({
    id,
    type: "text",
    role: options.role || "free",
    typographyRole: options.typographyRole,
    x,
    y,
    w,
    h,
    rotation: 0,
    zIndex,
    opacity: 1,
    locked: false,
    text,
    runs: [{ text }],
    fontSize: options.fontSize || 28,
    autoFit: options.autoFit,
    fontFamily: options.fontFamily || "Arial",
    color: options.color || "#161A1F",
    bold: Boolean(options.bold),
    italic: Boolean(options.italic),
    underline: Boolean(options.underline),
    align: options.align || "left",
    valign: options.valign || "top",
    groupId: options.groupId,
  });
}

function fitCanvasTextElement(element: CanvasTextElement): CanvasTextElement {
  const typography = typographyForCanvasText(element);
  const minimum = minimumReadableFontSize(element);
  const requestedFontSize = Math.max(element.fontSize, minimum);
  let fontSize = requestedFontSize;
  while (element.autoFit !== false && fontSize > minimum && estimatedTextHeight(element.text, fontSize, element.w) > element.h) {
    fontSize -= 1;
  }
  const text = addCanvasWordBreaks(
    compactCanvasTextToFit(element.text, fontSize, element.w, element.h, typography.lineHeight),
    estimatedCharactersPerLine(fontSize, element.w),
  );
  return {
    ...element,
    fontSize,
    text,
    runs: [{ text }],
  };
}

function addCanvasWordBreaks(value: string, charactersPerLine: number) {
  if (charactersPerLine < 2) return value;
  return value.replace(/\S+/g, (token) => {
    if (token.replace(/\u200B/g, "").length <= charactersPerLine) return token;
    return token
      .split(/\u200B/)
      .flatMap((segment) => segment.match(new RegExp(`.{1,${charactersPerLine}}`, "gu")) || [])
      .join("\u200B");
  });
}

function resizeTextPlaques(elements: CanvasElement[]) {
  const plaqueSizes = new Map<string, { width: number; height: number }>();
  elements.forEach((element) => {
    if (element.type !== "text" || !/-mini-\d+$/.test(element.id)) return;
    const width = plaqueWidth(element.text, element.fontSize);
    plaqueSizes.set(`${element.id}-shape`, {
      width,
      height: plaqueHeight(element.text, element.fontSize, width - PLAQUE_PADDING_X * 2),
    });
  });

  return elements.map((element) => {
    if (element.type === "shape") {
      const size = plaqueSizes.get(element.id);
      return size ? {
        ...element,
        w: Math.max(element.w, size.width),
        h: Math.max(element.h, size.height),
      } : element;
    }
    if (element.type === "text" && /-mini-\d+$/.test(element.id)) {
      const size = plaqueSizes.get(`${element.id}-shape`);
      return size ? {
        ...element,
        w: Math.max(element.w, size.width - PLAQUE_PADDING_X * 2),
        h: Math.max(element.h, size.height - PLAQUE_PADDING_Y * 2),
      } : element;
    }
    return element;
  });
}

function reflowTextPlaques(elements: CanvasElement[]) {
  const plaqueShapes = elements
    .filter((element): element is CanvasShapeElement =>
      element.type === "shape" && /-mini-\d+-shape$/.test(element.id),
    )
    .sort((left, right) => left.y - right.y || left.x - right.x);
  if (!plaqueShapes.length) return elements;

  const rows = new Map<number, CanvasShapeElement[]>();
  plaqueShapes.forEach((shape) => {
    const rowKey = Math.round(shape.y);
    rows.set(rowKey, [...(rows.get(rowKey) || []), shape]);
  });

  const updates = new Map<string, Partial<CanvasElement>>();
  rows.forEach((row) => {
    const sorted = [...row].sort((left, right) => left.x - right.x);
    const startX = Math.max(48, Math.min(...sorted.map((shape) => shape.x)));
    const rowTop = Math.min(...sorted.map((shape) => shape.y));
    const rowBottom = Math.max(...sorted.map((shape) => shape.y + shape.h));
    const imageBoundary = elements
      .filter((element): element is CanvasImageElement =>
        element.type === "image" &&
        element.x > startX &&
        element.y < rowBottom &&
        element.y + element.h > rowTop,
      )
      .reduce((boundary, image) => Math.min(boundary, image.x - 28), 1232);
    const rightBoundary = Math.max(startX + 150, imageBoundary);
    const gap = 18;
    const availableWidth = rightBoundary - startX;
    const desiredWidth = sorted.reduce((total, shape) => total + shape.w, 0) + gap * Math.max(0, sorted.length - 1);
    const fittedWidth = desiredWidth > availableWidth
      ? Math.max(150, Math.floor((availableWidth - gap * Math.max(0, sorted.length - 1)) / sorted.length))
      : 0;
    const rowHeight = Math.max(...sorted.map((shape) => {
      const text = elements.find((element): element is CanvasTextElement =>
        element.type === "text" && `${element.id}-shape` === shape.id,
      );
      const width = fittedWidth || shape.w;
      return text ? plaqueHeight(text.text, text.fontSize, width - PLAQUE_PADDING_X * 2) : shape.h;
    }));

    let nextX = startX;
    sorted.forEach((shape) => {
      const width = fittedWidth || shape.w;
      const textId = shape.id.replace(/-shape$/, "");
      updates.set(shape.id, { x: nextX, y: rowTop, w: width, h: rowHeight });
      updates.set(textId, {
        x: nextX + PLAQUE_PADDING_X,
        y: rowTop + PLAQUE_PADDING_Y,
        w: width - PLAQUE_PADDING_X * 2,
        h: rowHeight - PLAQUE_PADDING_Y * 2,
        align: "center",
        valign: "middle",
      });
      nextX += width + gap;
    });
  });

  return elements.map((element) => {
    const update = updates.get(element.id);
    return update ? { ...element, ...update } as CanvasElement : element;
  });
}

function estimatedPlaqueTextHeight(value: string, fontSize: number, width: number) {
  const safeWidth = Math.max(1, width);
  const charactersPerLine = Math.max(1, Math.floor(safeWidth / (fontSize * 0.75)));
  const lines = cleanCanvasText(value)
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
  return Math.ceil(lines * fontSize * 1.28);
}

function plaqueHeight(value: string, fontSize: number, width: number) {
  const wordCount = cleanCanvasText(value).split(/\s+/).filter(Boolean).length;
  const contentHeight = estimatedPlaqueTextHeight(value, fontSize, width) + 40;
  const longLabelMinimum = wordCount >= 6 ? 104 : wordCount >= 5 ? 88 : wordCount >= 4 ? 72 : 58;
  return Math.max(58, contentHeight, longLabelMinimum);
}

function plaqueWidth(value: string, fontSize: number) {
  const estimatedSingleLineWidth = cleanCanvasText(value).length * fontSize * 0.58 + PLAQUE_PADDING_X * 2;
  return Math.max(220, Math.min(330, Math.ceil(estimatedSingleLineWidth)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function imageElement(
  id: string,
  image: NonNullable<SlideVisual["image"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  zIndex: number,
  opacity: number,
  fit: CanvasImageElement["fit"],
): CanvasImageElement {
  return {
    id,
    type: "image",
    x,
    y,
    w,
    h,
    rotation: 0,
    zIndex,
    opacity,
    locked: false,
    url: image.url,
    objectKey: image.objectKey || "",
    alt: image.alt || "",
    contentType: image.contentType || "",
    fit,
    sourceWidth: image.width,
    sourceHeight: image.height,
    byteSize: image.byteSize,
  };
}

function imageFitForVisual(slide: Slide): CanvasImageElement["fit"] {
  const metadata = [slide.visual?.image?.alt, slide.visual?.image?.query, slide.visual?.description].filter(Boolean).join(" ");
  // Documentary photos benefit from cover, while documents, maps and technical
  // figures lose their subject when cropped into an editorial column.
  return /\b(?:diagram|technical|document|map|archive|blueprint|scheme|chart)\b|(?:схем|диаграм|документ|карт|архив|чертеж|график)/iu.test(metadata)
    ? "contain"
    : "cover";
}

function quoteText(slide: Slide) {
  const quote = (slide.blocks || []).find((block): block is Extract<SlideBlock, { type: "quote" }> => block.type === "quote");
  return quote?.content || slide.thesis || slideBodyText(slide);
}

function sequenceItems(slide: Slide) {
  const visualItems = (slide.visual?.items || []).map((item) => item.label || item.text).filter(Boolean);
  const graphItems = (slide.visual?.graph?.nodes || []).map((node) => node.detail || node.label).filter(Boolean);
  const diagramItems = splitCanvasSentences(slide.visual?.graph?.fallback || slide.visual?.diagram?.fallback || "").slice(0, 5);
  const blockItems = (slide.blocks || []).flatMap((block) => (block.type === "bullets" ? block.items : [block.content]));
  const bullets = slide.bullets || [];
  return (visualItems.length ? visualItems : graphItems.length ? graphItems : diagramItems.length ? diagramItems : bullets.length ? bullets : blockItems.length ? blockItems : [slide.thesis || slide.title]).filter(Boolean);
}

function talkBeats(slide: Slide) {
  const candidates = [
    ...uniqueCanvasItems(sequenceItems(slide)),
    ...splitCanvasSentences(slide.thesis || ""),
    ...splitCanvasSentences(slideBodyText(slide)),
  ];
  return uniqueCanvasItems(candidates)
    .map((item) => compactSummaryPoint(item, 13) || sentencePreview(item, 96))
    .filter(Boolean)
    .slice(0, 4);
}

function uniqueCanvasItems(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = cleanCanvasText(item).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function comparisonRows(slide: Slide) {
  if (slide.visual?.rows?.length) return slide.visual.rows;
  const bullets = slide.bullets || [];
  return [
    {
      label: slide.title,
      left: bullets[0] || slide.thesis,
      right: bullets[1] || slideBodyText(slide),
    },
  ];
}

export function hasMeasurableValue(text: string) {
  return /(?:^|[\s(])(?:\d{1,4}(?:[.,]\d+)?\s*(?:%|°[CFСФ]?|км|м|см|мм|кг|г|мл|л|₽|\$|€|млн|млрд|тыс\.?|лет|год(?:а|ов)?|век(?:а|ов)?|мин(?:ут[аы]?)?|сек(?:унд[аы]?)?|ч(?:ас(?:а|ов)?)?)|\d{4}\s*(?:г\.?|год(?:а)?)?)(?=$|[\s,.;:)])/iu.test(text);
}

export function metricLead(text: string) {
  return text.match(/(?:\d{1,4}(?:[.,]\d+)?\s*(?:%|°[CFСФ]?|км|м|см|мм|кг|г|мл|л|₽|\$|€|млн|млрд|тыс\.?|лет|год(?:а|ов)?|век(?:а|ов)?|мин(?:ут[аы]?)?|сек(?:унд[аы]?)?|ч(?:ас(?:а|ов)?)?)|\d{4}\s*(?:г\.?|год(?:а)?)?)/iu)?.[0] || "";
}

export function fittedFontSize(value: string, preferred: number, minimum: number, boxHeight: number) {
  const text = cleanCanvasText(value);
  const pressure = Math.max(text.length / 54, text.split(/\s+/).length / 9, text.split("\n").length);
  const heightPressure = Math.max(1, 120 / Math.max(boxHeight, 1));
  return Math.max(minimum, Math.round(preferred / Math.max(1, pressure * 0.72, heightPressure)));
}

export function compactSourceRefs(sourceRefs: SourceRef[], limit = 3) {
  return sourceRefs.slice(0, limit).map((ref) => {
    const location = ref.page ? `, ${ref.page}` : "";
    const excerpt = sentencePreview(ref.excerpt, 86);
    return [sentencePreview(ref.label, 42) + location, excerpt].filter(Boolean).join(" — ");
  });
}

function isDuplicateCanvasText(left: string, right: string) {
  const normalize = (value: string) => cleanCanvasText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  return Boolean(normalize(left) && normalize(left) === normalize(right));
}

function miniChipText(value: string, slide: Slide, index: number) {
  const bullets = slide.bullets || [];
  const primary = compactChipSentence(value, 12)
    || (!looksLikeChipFragment(value) ? compactSummaryPoint(value, 10) : "");
  if (primary) return primary;
  const candidates = [
    bullets[index + 1],
    slide.thesis,
    slide.title,
    slideBodyText(slide),
  ];
  const complete = candidates.map((candidate) => compactChipSentence(candidate, 12)).find(Boolean);
  if (complete) return complete;
  const source = candidates.find((candidate) => phraseWords(candidate).length >= 5) || candidates.find(Boolean) || "";
  const words = phraseWords(source);
  const fallback = words.join(" ");
  return fallback && words.length <= 12 && !looksLikeChipFragment(fallback) ? `${fallback}.` : compactChipSentence(slide.title, 12);
}

function compactSummaryPoint(value: string, maxWords: number) {
  const text = cleanCanvasText(value);
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const complete = sentences.find((sentence) => {
    const count = phraseWords(sentence).length;
    return count >= 3 && count <= maxWords && !looksLikeChipFragment(sentence);
  });
  if (complete) return /[.!?]$/.test(complete) ? complete : `${complete}.`;

  const source = sentences[0] || text;
  const clause = source
    .split(/[,;:–—]\s*/)
    .map((part) => part.trim())
    .find((part) => {
      const count = phraseWords(part).length;
      return count >= 3 && count <= maxWords && !looksLikeChipFragment(part);
    });
  if (clause) return /[.!?]$/.test(clause) ? clause : `${clause}.`;

  const words = phraseWords(source).slice(0, maxWords);
  while (words.length > 3 && /^(и|или|но|а|что|чтобы|когда|если|and|or|but|that)$/iu.test(words.at(-1) || "")) {
    words.pop();
  }
  return words.length ? `${words.join(" ")}.` : "";
}

function compactChipSentence(value: string, maxWords: number) {
  const text = cleanCanvasText(value);
  if (!text) return "";
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const source = sentences.find((sentence) => !looksLikeChipFragment(sentence)) || (!/[.!?]/.test(text) && !looksLikeChipFragment(text) ? text : "");
  if (!source) return "";
  const words = phraseWords(source);
  if (!words.length) return "";
  if (words.length > maxWords) return "";
  const sentence = words.join(" ");
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function looksLikeChipFragment(value: string) {
  const text = cleanCanvasText(value).replace(/[.!?]+$/g, "").toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const last = words.at(-1) || "";
  if (words.length < 2) return true;
  if (/[,;:\-–—]$/.test(text)) return true;
  const hasPredicateSetup = /(?:^|[^\p{L}])(\u044d\u0442\u043e|\u044d\u0442\u0430|\u044d\u0442\u043e\u0442|\u044d\u0442\u0438|\u044f\u0432\u043b\u044f\u0435\u0442\u0441\u044f|\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0441\u044f|\u043e\u0441\u0442\u0430\u0435\u0442\u0441\u044f|\u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f|\u0431\u044b\u043b\u0430|\u0431\u044b\u043b|\u0431\u044b\u043b\u043e|\u0431\u0443\u0434\u0435\u0442|\u0441\u0442\u0430\u043b\u0430|\u0441\u0442\u0430\u043b|\u0441\u0442\u0430\u043b\u043e)(?=$|[^\p{L}])/iu.test(text);
  return hasPredicateSetup && /(\u0430\u044f|\u044f\u044f|\u044b\u0439|\u0438\u0439|\u043e\u0439|\u043e\u0435|\u0435\u0435|\u044b\u0435|\u0438\u0435|\u0443\u044e|\u044e\u044e|\u043e\u0433\u043e|\u0435\u0433\u043e|\u043e\u043c\u0443|\u0435\u043c\u0443|\u044b\u043c|\u0438\u043c|\u044b\u0445|\u0438\u0445)$/.test(last);
}

function phraseWords(value: string) {
  return cleanCanvasText(value)
    .replace(/\.{3,}|…/g, "")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%№+-]+$/gu, ""))
    .filter(Boolean);
}

function slideBodyText(slide: Slide) {
  const text = [
    slide.thesis,
    ...(slide.bullets || []),
    slide.definition ? `${slide.definition.term}: ${slide.definition.text}` : "",
    slide.visual?.graph?.fallback || "",
    slide.visual?.diagram?.fallback || "",
    ...(slide.blocks || []).flatMap((block) => (block.type === "bullets" ? block.items : [block.content])),
  ]
    .filter(Boolean)
    .join(" ");
  return sentencePreview(text || slide.title, 360);
}

function constrainSlideToLayoutCapacity(slide: Slide): Slide {
  const capacity = presentationLayoutCapacity(slide.layout);
  const textLimit = Math.max(72, Math.min(180, Math.round(capacity.minColumnWidth * 0.42)));
  const compact = (value: string, limit = textLimit) => sentencePreview(value, limit);
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  const blocks = Array.isArray(slide.blocks) ? slide.blocks : [];
  const visual = slide.visual || {
    type: "none",
    title: "",
    description: "",
    leftLabel: "",
    rightLabel: "",
    items: [],
    rows: [],
  };
  const visualItems = Array.isArray(visual.items) ? visual.items : [];
  const visualRows = Array.isArray(visual.rows) ? visual.rows : [];
  return {
    ...slide,
    title: compact(slide.title || "", Math.max(52, Math.min(96, Math.round(capacity.minColumnWidth * 0.32)))),
    thesis: compact(slide.thesis || "", textLimit),
    bullets: bullets.slice(0, capacity.maxItems).map((item) => compact(item, textLimit)),
    blocks: blocks.map((block) => block.type === "bullets"
      ? { ...block, items: block.items.slice(0, capacity.maxItems).map((item) => compact(item, textLimit)) }
      : { ...block, content: compact(block.content, textLimit) }),
    visual: {
      ...visual,
      description: compact(visual.description, textLimit),
      items: visualItems.slice(0, capacity.maxItems).map((item) => ({ ...item, label: compact(item.label, 64), text: compact(item.text, textLimit) })),
      rows: visualRows.slice(0, capacity.maxItems).map((row) => ({ ...row, label: compact(row.label, 64), left: compact(row.left, textLimit), right: compact(row.right, textLimit) })),
    },
  };
}

function splitCanvasSentences(value: string) {
  return cleanCanvasText(value)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sentencePreview(value: string, maxLength: number) {
  const text = cleanCanvasText(value);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3);
  const preview = sentences.reduce<string[]>((result, sentence) => {
    const candidate = [...result, sentence].join(" ");
    return candidate.length <= maxLength ? [...result, sentence] : result;
  }, []).join(" ");
  if (preview) return preview;
  if (text.length <= maxLength) return text;

  // Titles and labels may not have sentence punctuation. Keep a clean phrase
  // instead of silently cutting a sentence and appending an ellipsis.
  return text.split(/\s+/).reduce<string[]>((words, word) => {
    const candidate = [...words, word].join(" ");
    return candidate.length <= maxLength ? [...words, word] : words;
  }, []).join(" ");
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
