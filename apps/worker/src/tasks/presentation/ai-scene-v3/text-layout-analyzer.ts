import {
  aiSceneV3MinimumFontSize,
  estimatedTextHeight,
  textLayoutV3Schema,
  type CompositionPlanV3,
  type DeckArtDirectionV3,
  type SlideSemanticBriefV3,
  type TextLayoutV3,
} from "@studydeck/shared";
import { aiSceneV3NativeBackplateBounds } from "./native-backplate.js";

// These match the shared native-canvas audit. Gate 1 applies them to the
// editable text box, rather than to its intentionally extended backplate.
const NATIVE_TEXT_SAFE_BOUNDS = { left: 48, top: 32, right: 1232, bottom: 680 };

/** Checks that a high-detail vision response only positions immutable semantic text. */
export function validateAiSceneV3TextLayout(input: {
  value: unknown;
  brief: SlideSemanticBriefV3;
  plan: CompositionPlanV3;
  artDirection: DeckArtDirectionV3;
}): TextLayoutV3 {
  const parsed = textLayoutV3Schema.safeParse(input.value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".") || "root"}:${issue.code === "invalid_type" && issue.received === "undefined" ? "required" : issue.message}`)
      .join(";");
    throw new Error(`ai_scene_v3_text_layout_contract_invalid:${issues || "unknown"}`);
  }
  const layout = parsed.data;
  if (layout.slideId !== input.brief.slideId) throw new Error("ai_scene_v3_text_layout_slide_mismatch");
  const requiredIds = new Set<TextLayoutV3["entries"][number]["semanticId"]>(["title"]);
  for (const anchor of input.brief.anchors) requiredIds.add(anchor.id as TextLayoutV3["entries"][number]["semanticId"]);
  if (input.brief.conclusion) requiredIds.add("conclusion");
  const actualIds = new Set(layout.entries.map((entry) => entry.semanticId));
  if (requiredIds.size !== actualIds.size || [...requiredIds].some((id) => !actualIds.has(id))) throw new Error("ai_scene_v3_text_layout_semantic_ids_mismatch");
  const plannedZones = new Map(input.plan.textZones.map((entry) => [entry.semanticId, entry.zone]));
  for (const entry of layout.entries) {
    const zone = plannedZones.get(entry.semanticId);
    if (!zone || !withinPlannedZone(entry, zone)) throw new Error(`ai_scene_v3_text_layout_outside_quiet_zone:${entry.semanticId}`);
    if (entry.fontFamily !== input.artDirection.typography.primaryFontFamily || entry.fallbackFontFamily !== input.artDirection.typography.fallbackFontFamily) {
      throw new Error("ai_scene_v3_text_layout_font_mismatch");
    }
  }
  const geometryDiagnostics = aiSceneV3TextLayoutGeometryDiagnostics(layout, input.plan);
  if (geometryDiagnostics.length) throw new Error(`ai_scene_v3_text_layout_unsafe_geometry:${geometryDiagnostics.join(";")}`);
  const fitDiagnostics = aiSceneV3TextFitDiagnostics(layout, input.brief);
  if (fitDiagnostics.length) throw new Error(`ai_scene_v3_text_layout_unreadable:${fitDiagnostics.join(";")}`);
  return layout;
}

/** The actual high-detail image must be attached by the provider implementation, never downscaled to the old 640x360 input. */
export function aiSceneV3TextLayoutPrompt(input: {
  brief: SlideSemanticBriefV3;
  plan: CompositionPlanV3;
  artDirection: DeckArtDirectionV3;
  backgroundWidth: number;
  backgroundHeight: number;
}) {
  if (input.backgroundWidth < 1280 || input.backgroundHeight < 720 || input.backgroundWidth * 9 !== input.backgroundHeight * 16) {
    throw new Error("ai_scene_v3_text_layout_high_detail_16_9_required");
  }
  return [
    "Inspect the attached exact 16:9 PNG at high detail and return one compact minified JSON object only for TextLayoutV3 version 3.",
    "The top-level object MUST contain only version, slideId and entries. entries MUST be an array with exactly one entry for every supplied semantic ID; no prose, markdown, comments, text values, OCR, or extra keys.",
    "Every entry MUST contain semanticId,x,y,w,h,fontFamily,fallbackFontFamily,fontSize,minimumFontSize,fontWeight,lineHeight,letterSpacing,color,align,verticalAlign,maxLines,editable,zoneReason,contrastScore,placementConfidence. Use short zoneReason values. All coordinates are 1280x720 pixels.",
    `required response identity: ${JSON.stringify({ version: 3, slideId: input.brief.slideId, semanticIds: ["title", ...input.brief.anchors.map((anchor) => anchor.id), ...(input.brief.conclusion ? ["conclusion"] : [])] })}`,
    "Return placement and typography only. Do not rewrite, shorten, infer, OCR, or add text values. All values remain native editable overlay elements.",
    "Gate 1 uses fixed safe native sizes: title fontSize MUST be exactly 40px and every anchor fontSize MUST be exactly 24px. minimumFontSize remains the readable floor (title >=40px; anchors >=24px), not a substitute for the actual fontSize. maxLines MUST exactly equal the corresponding composition-plan textZone.maxLines; title and anchors may never exceed two lines. editable MUST be true.",
    "Use lineHeight exactly 1.12 for title and exactly 1.14 for every other entry; verticalAlign MUST be top. These are the exact native preview/export renderer values.",
    "Every output box must stay wholly inside its matching textZone and inside the native readable inner bounds x=48..1232, y=32..680. Apply those bounds to the editable text boxes only, never to the deliberately extended native backplates. Text boxes must not overlap each other or any protectedObjectZone. quietZones are clear low-detail fields: do not place text over planets, orbits, image cards, lines, or other high-detail imagery. Keep readable contrast and use the supplied font families exactly. contrastScore and placementConfidence are observations only; Gate 1 independently verifies the rendered native backplates, geometry, and vision evidence.",
    `art direction: ${JSON.stringify({ palette: input.artDirection.palette, typography: input.artDirection.typography, whitespaceRules: input.artDirection.whitespaceRules })}`,
    `composition plan: ${JSON.stringify(input.plan)}`,
  ].join("\n");
}

export function aiSceneV3TextFitDiagnostics(layout: TextLayoutV3, brief: SlideSemanticBriefV3) {
  const values = new Map<string, string>([
    ["title", brief.title.text] as const,
    ...brief.anchors.map((anchor) => [anchor.id, anchor.text] as const),
    ...(brief.conclusion ? [["conclusion", brief.conclusion.text] as const] : []),
  ]);
  return layout.entries.flatMap((entry) => {
    const text = values.get(entry.semanticId);
    if (!text) return [`${entry.semanticId}:text_missing`];
    const minimum = aiSceneV3MinimumFontSize(entry.semanticId);
    // This must mirror the actual native-canvas render.  In particular, the
    // readable minimum is a floor, never a stand-in for a larger fontSize
    // supplied by the layout provider.
    const requiredHeight = estimatedTextHeight(text, entry.fontSize, entry.w, entry.lineHeight);
    const allowedLines = entry.semanticId === "title" || entry.semanticId.startsWith("anchor:") ? 2 : entry.maxLines;
    const allowedHeight = Math.min(entry.h, entry.maxLines * entry.fontSize * entry.lineHeight, allowedLines * entry.fontSize * entry.lineHeight);
    const errors: string[] = [];
    if (entry.fontSize < minimum || entry.minimumFontSize < minimum) errors.push(`font_below_${minimum}px`);
    const safeFontSize = gate1SafeFontSize(entry.semanticId);
    if (safeFontSize !== undefined && entry.fontSize !== safeFontSize) errors.push(`font_size_must_equal_${safeFontSize}px`);
    if (!entry.editable) errors.push("not_editable");
    if (entry.maxLines > allowedLines) errors.push(`max_lines_exceeds_${allowedLines}`);
    if (requiredHeight > allowedHeight * 1.02) errors.push(`text_does_not_fit_${Math.ceil(requiredHeight)}px_in_${Math.floor(allowedHeight)}px`);
    return errors.length ? [`${entry.semanticId}:${errors.join(",")}`] : [];
  });
}

/**
 * Uses the same fixed typography and rectangles as the native canvas renderer.
 * This rejects a syntactically valid layout before it can produce an ambiguous
 * title/anchor collision or place text over a protected visual region.
 */
export function aiSceneV3TextLayoutGeometryDiagnostics(layout: TextLayoutV3, plan: CompositionPlanV3) {
  const plannedZones = new Map(plan.textZones.map((entry) => [entry.semanticId, entry]));
  const errors: string[] = [];
  for (const entry of layout.entries) {
    const planned = plannedZones.get(entry.semanticId);
    if (!planned || !withinPlannedZone(entry, planned.zone)) {
      errors.push(`${entry.semanticId}:outside_text_zone`);
      continue;
    }
    if (entry.maxLines !== planned.maxLines) errors.push(`${entry.semanticId}:max_lines_mismatch`);
    if (Math.abs(entry.lineHeight - canonicalLineHeight(entry.semanticId)) > .001) errors.push(`${entry.semanticId}:line_height_mismatch`);
    if (entry.verticalAlign !== "top") errors.push(`${entry.semanticId}:vertical_align_mismatch`);
    if (!withinNativeTextSafeBounds(entry)) errors.push(`${entry.semanticId}:outside_native_text_safe_bounds`);
    if (plan.protectedObjectZones.some((zone) => rectanglesOverlap(aiSceneV3NativeBackplateBounds(entry), normalizedToCanvas(zone)))) {
      errors.push(`${entry.semanticId}:backplate_overlaps_protected_object_zone`);
    }
  }
  for (const [index, entry] of layout.entries.entries()) {
    for (const other of layout.entries.slice(index + 1)) {
      if (rectanglesOverlap(aiSceneV3NativeBackplateBounds(entry), aiSceneV3NativeBackplateBounds(other))) {
        errors.push(`${entry.semanticId}:backplate_overlaps_${other.semanticId}`);
      }
    }
  }
  return errors;
}

function withinPlannedZone(entry: TextLayoutV3["entries"][number], zone: { x: number; y: number; w: number; h: number }) {
  const tolerance = 1;
  const x = zone.x * 1280 - tolerance;
  const y = zone.y * 720 - tolerance;
  const w = zone.w * 1280 + tolerance * 2;
  const h = zone.h * 720 + tolerance * 2;
  return entry.x >= x && entry.y >= y && entry.x + entry.w <= x + w && entry.y + entry.h <= y + h;
}

function canonicalLineHeight(semanticId: TextLayoutV3["entries"][number]["semanticId"]) {
  return semanticId === "title" ? 1.12 : 1.14;
}

/** Gate 1 fixes the size of the dense mandatory overlay before vision review.
 * The readable minima remain hard floors; the fixed actual size prevents a
 * provider from making an otherwise valid two-line box overflow at render. */
function gate1SafeFontSize(semanticId: TextLayoutV3["entries"][number]["semanticId"]) {
  if (semanticId === "title") return 40;
  if (semanticId.startsWith("anchor:")) return 24;
  return undefined;
}

function normalizedToCanvas(zone: { x: number; y: number; w: number; h: number }) {
  return { x: zone.x * 1280, y: zone.y * 720, w: zone.w * 1280, h: zone.h * 720 };
}

function withinNativeTextSafeBounds(entry: Pick<TextLayoutV3["entries"][number], "x" | "y" | "w" | "h">) {
  return entry.x >= NATIVE_TEXT_SAFE_BOUNDS.left && entry.y >= NATIVE_TEXT_SAFE_BOUNDS.top
    && entry.x + entry.w <= NATIVE_TEXT_SAFE_BOUNDS.right && entry.y + entry.h <= NATIVE_TEXT_SAFE_BOUNDS.bottom;
}

function rectanglesOverlap(left: { x: number; y: number; w: number; h: number }, right: { x: number; y: number; w: number; h: number }) {
  return Math.min(left.x + left.w, right.x + right.w) > Math.max(left.x, right.x)
    && Math.min(left.y + left.h, right.y + right.h) > Math.max(left.y, right.y);
}
