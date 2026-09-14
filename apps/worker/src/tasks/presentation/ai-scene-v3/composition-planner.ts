import {
  aiSceneV3MinimumFontSize,
  compositionPlanV3Schema,
  estimatedTextHeight,
  type CompositionPlanV3,
  type SlideSemanticBriefV3,
  type TextLayoutV3,
} from "@studydeck/shared";

/** Validates a Luna plan without allowing a local template fallback. */
export function validateAiSceneV3CompositionPlan(value: unknown, brief: SlideSemanticBriefV3): CompositionPlanV3 {
  const plan = compositionPlanV3Schema.parse(value);
  if (plan.slideId !== brief.slideId || plan.slideOrder !== brief.slideOrder) throw new Error("ai_scene_v3_composition_slide_mismatch");
  if (!brief.allowedCompositionTypes.includes(plan.compositionType)) throw new Error("ai_scene_v3_composition_type_not_allowed");
  const requiredTextIds: TextLayoutV3["entries"][number]["semanticId"][] = ["title"];
  requiredTextIds.push(...brief.anchors.map((anchor) => anchor.id as TextLayoutV3["entries"][number]["semanticId"]));
  if (brief.conclusion) requiredTextIds.push("conclusion");
  const plannedTextIds = new Set(plan.textZones.map((entry) => entry.semanticId));
  if (requiredTextIds.some((id) => !plannedTextIds.has(id))) throw new Error("ai_scene_v3_composition_text_zone_missing");
  const plannedAnchorIds = new Set(plan.anchorVisualRegions.map((entry) => entry.anchorId));
  if (brief.kind === "content" && brief.anchors.some((anchor) => !plannedAnchorIds.has(anchor.id))) {
    throw new Error("ai_scene_v3_composition_anchor_region_missing");
  }
  const unreadableZone = plan.textZones.find((entry) => !zoneFitsSemanticText(entry.semanticId, entry.zone, brief));
  if (unreadableZone) throw new Error(`ai_scene_v3_composition_text_zone_unreadable:${unreadableZone.semanticId}`);
  return plan;
}

export function validateAiSceneV3CompositionPair(leftValue: unknown, rightValue: unknown, brief: SlideSemanticBriefV3) {
  const left = validateAiSceneV3CompositionPlan(leftValue, brief);
  const right = validateAiSceneV3CompositionPlan(rightValue, brief);
  if (left.variant !== "A" || right.variant !== "B") throw new Error("ai_scene_v3_composition_pair_variants_required");
  if (left.compositionType === right.compositionType) {
    throw new Error("ai_scene_v3_composition_pair_not_distinct");
  }
  return [left, right] as const;
}

/** Reject a plan before the paid background call when its own quiet zone can
 * never hold the exact native text at the hard readable minima. */
function zoneFitsSemanticText(
  semanticId: TextLayoutV3["entries"][number]["semanticId"],
  zone: { w: number; h: number },
  brief: SlideSemanticBriefV3,
) {
  const text = semanticId === "title"
    ? brief.title.text
    : semanticId.startsWith("anchor:")
    ? brief.anchors.find((anchor) => anchor.id === semanticId)?.text
    : semanticId === "conclusion"
    ? brief.conclusion?.text
    : undefined;
  if (!text) return false;
  const minimum = aiSceneV3MinimumFontSize(semanticId);
  const maxLines = semanticId === "title" || semanticId.startsWith("anchor:") ? 2 : 3;
  const lineHeight = semanticId === "title" ? 1.12 : 1.14;
  const availableWidth = Math.max(1, zone.w * 1280 - 16);
  const availableHeight = Math.min(Math.max(1, zone.h * 720 - 8), maxLines * minimum * lineHeight);
  return estimatedTextHeight(text, minimum, availableWidth, lineHeight) <= availableHeight * 1.02;
}

export function aiSceneV3CompositionPrompt(
  brief: SlideSemanticBriefV3,
  variant: "A" | "B",
  options: { forbiddenCompositionTypes?: readonly CompositionPlanV3["compositionType"][] } = {},
) {
  const forbidden = [...new Set(options.forbiddenCompositionTypes || [])];
  return [
    "Return JSON only for CompositionPlanV3 version 3.",
    `Create option ${variant}; it must reserve one native text zone for title and every anchor/conclusion, and one visual region for every anchor. Every textZone MUST include maxLines (1 or 2).`,
    forbidden.length ? `This option MUST use a compositionType different from: ${forbidden.join(", ")}. A mirrored, recolored, or side-swapped version is not a distinct composition.` : "The paired option must use a different compositionType; a mirrored, recolored, or side-swapped version is not distinct.",
    "Use one clear main visual focus. Avoid repeated UI-card grids, baked lettering, labels, numbers, logos, brand marks, automotive badges, crests, emblems and watermarks. The background is textless; text zones are for a native editable overlay.",
    "Every text zone must be wholly inside a quietZone, must not intersect another textZone or any protectedObjectZone, and must fit the exact semantic text at its required readable size. quietZones are blank low-detail fields: reserve them before placing imagery. protectedObjectZones are image-only: no native text may enter them.",
    `semantic brief: ${JSON.stringify(brief)}`,
  ].join("\n");
}
