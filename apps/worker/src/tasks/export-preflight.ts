import {
  auditSlideCanvas,
  auditCanonicalSlideCanvas,
  buildSlideCanvas,
  hasCustomSlideCanvas,
  presentationSchema,
  resolvePresentationTheme,
  type ExportPreflightFormat,
  type ExportPreflightReport,
  type PresentationDocument,
  type Slide,
} from "@studydeck/shared";
import {
  critiquePresentationDeterministically,
  improvePresentationQuality,
  type QualityProjectInput,
} from "./presentation-quality.js";
import { findSlideTextIssues } from "./presentation/quality/orchestration.js";
import { parseNarrationSections } from "./presentation/narration/processing.js";

export type ExportPreflightResult = {
  document: PresentationDocument;
  report: ExportPreflightReport;
  initialReport: ExportPreflightReport;
};

type ExportPreflightOptions = {
  format: ExportPreflightFormat;
  project: QualityProjectInput;
  readObject: (objectKey: string) => Promise<Buffer>;
};

type Issue = {
  slideId: string;
  category: string;
  repairable: boolean;
  blocking?: boolean;
};

/**
 * Prepares the one in-memory document used by both PPTX and PDF serializers.
 * This deliberately never writes repairs to Prisma: an export is a derived
 * artifact, while edits to the presentation remain an explicit user action.
 */
export async function preparePresentationForExport(
  input: PresentationDocument,
  options: ExportPreflightOptions,
): Promise<ExportPreflightResult> {
  const parsed = presentationSchema.parse(input);
  const initialIssues = await collectIssues(parsed, options);
  const initialReport = toReport(options.format, initialIssues, false);

  // A released document is already a persisted canonical revision. Export may
  // validate it, but may not silently manufacture a different in-memory
  // revision for one of the serializers.
  if (parsed.productionQualityGate) {
    return { document: parsed, report: initialReport, initialReport };
  }

  // A fully legacy document is deliberately allowed through the template
  // renderer. Mixed or generated documents are normalized to the shared
  // canvas source of truth before either format is serialized.
  const legacyNoCanvas = parsed.slides.every((slide) => !slide.canvas);
  if (legacyNoCanvas) return { document: parsed, report: initialReport, initialReport };

  const generatedIssueIds = new Set(initialIssues.filter((issue) => issue.repairable).map((issue) => issue.slideId));
  if (!generatedIssueIds.size) return { document: parsed, report: initialReport, initialReport };

  const imageSafe = removeUnavailableGeneratedImages(parsed, initialIssues);
  // Reuse the bounded common quality pipeline for deterministic local
  // fallbacks. No second export-specific model client is created here; model
  // repair belongs to generation, where provider callbacks and accepted
  // narration are available.
  const qualityRepaired = await improvePresentationQuality(
    imageSafe,
    options.project,
    imageSafe.sources,
    "demo",
    { maxRepairAttempts: 0 },
  );
  const repaired = rebuildAffectedGeneratedCanvases(qualityRepaired, generatedIssueIds);
  const finalIssues = await collectIssues(repaired, options);
  const report = toReport(options.format, finalIssues, true);
  return { document: repaired, report, initialReport };
}

async function collectIssues(document: PresentationDocument, options: ExportPreflightOptions): Promise<Issue[]> {
  const issues: Issue[] = [];
  const theme = resolvePresentationTheme({
    title: document.title,
    scenario: document.scenario,
    level: document.level,
    presentationTheme: document.presentationTheme,
    designBrief: document.designBrief,
  });
  const isLegacyNoCanvas = document.slides.every((slide) => !slide.canvas);
  const customById = new Map(document.slides.map((slide) => [slide.id, isCustomCanvas(slide, theme)]));
  const quality = isLegacyNoCanvas
    ? { issues: [] }
    : critiquePresentationDeterministically(document, document.sources, options.project);
  const releasedCanonicalNarration = hasReleasedCanonicalNarration(document);

  // The export preflight must use the same sentence-integrity detector as the
  // normal presentation path. Otherwise a legacy generated canvas can carry
  // a short predicate fragment (for example, "Porsche 911 показал.") past
  // the derived-artifact repair even though the editor would reject it.
  for (const textIssue of findSlideTextIssues(document)) {
    const slide = document.slides.find((candidate) => candidate.order === textIssue.slideOrder);
    if (!slide) continue;
    issues.push({
      slideId: slide.id,
      category: "canonical_content",
      repairable: !customById.get(slide.id),
      blocking: Boolean(document.productionQualityGate),
    });
  }

  for (const qualityIssue of quality.issues) {
    // The production gate has already accepted the canonical long-form
    // narration. Export must verify the stored projection, but it must not
    // reapply a conclusion heuristic to the same synchronized speaker notes.
    if (
      releasedCanonicalNarration
      && (qualityIssue.category === "generic_text" || qualityIssue.category === "bad_narration")
      && qualityIssue.field === "speakerNotes"
    ) {
      continue;
    }
    const slideId = qualityIssue.slideId;
    if (!slideId) continue;
    const category = qualityIssue.category === "schema_risk" ? "canvas" : qualityIssue.category;
    issues.push({
      slideId,
      category,
      repairable: !customById.get(slideId),
      // A released document may retain advisory quality findings because the
      // production gate deliberately permits minor issues and major issues
      // above the calibrated quality threshold. Only a blocker or an export
      // schema risk should prevent serializing that already accepted revision.
      blocking: Boolean(document.productionQualityGate)
        && (qualityIssue.severity === "blocker" || qualityIssue.category === "schema_risk"),
    });
  }

  for (const slide of document.slides) {
    const custom = customById.get(slide.id) || false;
    if (!slide.canvas) {
      if (!isLegacyNoCanvas) issues.push({ slideId: slide.id, category: "missing_canvas", repairable: !custom });
    } else {
      for (const canvasIssue of auditSlideCanvas(slide.canvas)) {
        issues.push({ slideId: slide.id, category: canvasCategory(canvasIssue), repairable: !custom });
      }
    }

    if (auditCanonicalSlideCanvas(slide).length) {
      issues.push({
        slideId: slide.id,
        category: "canonical_content",
        repairable: !custom,
        blocking: Boolean(document.productionQualityGate),
      });
      // The report is category-oriented; one canonicality entry per slide is
      // enough to route the document back through the persisted repair path.
    }

    for (const objectKey of imageObjectKeys(slide)) {
      try {
        await options.readObject(objectKey);
      } catch {
        issues.push({
          slideId: slide.id,
          category: "missing_image_object",
          repairable: !custom,
          blocking: custom,
        });
      }
    }

    const sourceIds = new Set(document.sources.map((source) => source.id));
    if (slide.sourceRefs.some((reference) => !sourceIds.has(reference.sourceId))) {
      issues.push({ slideId: slide.id, category: "source_attribution", repairable: !custom });
    }
    if (slide.visual.image && !slide.visual.image.sourceTitle && !slide.visual.image.sourceUrl) {
      issues.push({ slideId: slide.id, category: "source_attribution", repairable: !custom });
    }
  }

  // A released document cannot be repaired only for this export. Blocking
  // defects must be handled through the normal persisted revision path first;
  // advisory quality findings remain visible in the transient report.
  return dedupeIssues(issues);
}

function hasReleasedCanonicalNarration(document: PresentationDocument) {
  if (!document.productionQualityGate) return false;
  const sections = parseNarrationSections(document.generatedText);
  if (sections.length !== document.slides.length) return false;

  const sectionByOrder = new Map(sections.map((section) => [section.order, section]));
  return document.slides.every((slide) => {
    const section = sectionByOrder.get(slide.order);
    const script = document.speechScript.find((item) => item.slideOrder === slide.order);
    return Boolean(
      section?.text.trim()
      && script?.slideTitle === slide.title
      && script.text.trim() === section.text.trim()
      && slide.speakerNotes.trim() === section.text.trim(),
    );
  });
}

function removeUnavailableGeneratedImages(document: PresentationDocument, issues: Issue[]): PresentationDocument {
  const affected = new Set(issues
    .filter((issue) => issue.category === "missing_image_object" && issue.repairable)
    .map((issue) => issue.slideId));
  if (!affected.size) return document;
  return presentationSchema.parse({
    ...document,
    slides: document.slides.map((slide) => affected.has(slide.id)
      ? { ...slide, visual: { ...slide.visual, image: undefined } }
      : slide),
  });
}

function rebuildAffectedGeneratedCanvases(document: PresentationDocument, affectedSlideIds: Set<string>): PresentationDocument {
  const theme = resolvePresentationTheme({
    title: document.title,
    scenario: document.scenario,
    level: document.level,
    presentationTheme: document.presentationTheme,
    designBrief: document.designBrief,
  });
  return presentationSchema.parse({
    ...document,
    slides: document.slides.map((slide) => {
      if (!affectedSlideIds.has(slide.id) || isCustomCanvas(slide, theme)) return slide;
      const designDirection = document.designBrief?.slideDirections.find((direction) => direction.slideOrder === slide.order);
      return { ...slide, canvas: buildSlideCanvas(slide, theme, { designDirection }) };
    }),
  });
}

function imageObjectKeys(slide: Slide) {
  const keys = new Set<string>();
  if (slide.visual.image?.objectKey) keys.add(slide.visual.image.objectKey);
  slide.canvas?.elements.forEach((element) => {
    if (element.type === "image" && element.objectKey) keys.add(element.objectKey);
  });
  return keys;
}

function isCustomCanvas(slide: Slide, theme: ReturnType<typeof resolvePresentationTheme>) {
  if (!slide.canvas) return false;
  if (slide.canvas.elements.some((element) => element.id === `${slide.id}-custom-canvas-marker`)) return true;
  if (!hasCustomSlideCanvas(slide, theme)) return false;
  // Older generated canvases can be structurally unsafe after typography or
  // layout upgrades, which makes the conservative shared detector classify
  // them as edited. Their stable generated IDs let export repair rebuild only
  // that known projection; arbitrary user element IDs remain untouched.
  return !slide.canvas.elements.every((element) => element.id.startsWith(`${slide.id}-`));
}

function canvasCategory(issue: string) {
  if (/below|text column|text capacity|text does not fit|overflow/i.test(issue)) return "typography_overflow";
  if (/overlap|bounds|safe margins|dimensions/i.test(issue)) return "canvas_geometry";
  return "canvas";
}

function toReport(format: ExportPreflightFormat, issues: Issue[], repaired: boolean): ExportPreflightReport {
  const bySlide = new Map<string, { categories: Set<string>; repairable: boolean }>();
  for (const issue of issues) {
    const entry = bySlide.get(issue.slideId) || { categories: new Set<string>(), repairable: true };
    entry.categories.add(issue.category);
    entry.repairable &&= issue.repairable;
    bySlide.set(issue.slideId, entry);
  }
  return {
    // Only blockers prevent artifact creation. Unchanged custom layout
    // warnings remain observable in the structured report without turning an
    // export click into a new user-facing quality gate.
    passed: !issues.some((issue) => issue.blocking),
    repaired,
    format,
    slideIssues: [...bySlide].map(([slideId, issue]) => ({
      slideId,
      categories: [...issue.categories].sort(),
      repairable: issue.repairable,
    })),
  };
}

function dedupeIssues(issues: Issue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.slideId}|${issue.category}|${issue.repairable}|${issue.blocking || false}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
