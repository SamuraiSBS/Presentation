import {
  type CompositionPlanV3,
  type DeckArtDirectionV3,
  type ProviderCapabilitySnapshot,
  type SlideSemanticBriefV3,
} from "@studydeck/shared";
import { generateAitunnelImage, type GeneratedAitunnelImage } from "../../../aitunnel-image.js";
import { AI_SCENE_V3_MAX_REFERENCE_IMAGES, aiSceneV3ImageEnv, assertAiSceneV3ProviderPreflight, verifyAiSceneV3GeneratedPng } from "./provider-preflight.js";
import { aiSceneV3NativeBackplateBounds } from "./native-backplate.js";

type EnvLike = Record<string, string | undefined>;

export type AiSceneV3GeneratedBackground = GeneratedAitunnelImage & {
  dimensions: { width: number; height: number };
  referenceIds: string[];
};

/** Generates one final unmodified PNG background; there is no clean-background retry path. */
export async function generateAiSceneV3Background(input: {
  env: EnvLike;
  capabilities: ProviderCapabilitySnapshot;
  artDirection: DeckArtDirectionV3;
  brief: SlideSemanticBriefV3;
  plan: CompositionPlanV3;
  references: readonly { id: string; url: string }[];
}, dependencies: { generate?: typeof generateAitunnelImage } = {}): Promise<AiSceneV3GeneratedBackground> {
  const preflight = assertAiSceneV3ProviderPreflight(input.env, input.capabilities);
  if (input.references.length < 1 || input.references.length > AI_SCENE_V3_MAX_REFERENCE_IMAGES) throw new Error("ai_scene_v3_background_references_required");
  if (input.plan.slideId !== input.brief.slideId || input.plan.slideOrder !== input.brief.slideOrder) throw new Error("ai_scene_v3_background_plan_mismatch");
  const references = input.references.map((reference) => ({ type: "image_url" as const, image_url: { url: providerReadableUrl(reference.url) } }));
  const generated = await (dependencies.generate || generateAitunnelImage)(
    aiSceneV3BackgroundPrompt(input.artDirection, input.brief, input.plan),
    aiSceneV3ImageEnv(input.env),
    { purpose: "ai_scene_v3_background", inputReferences: references },
  );
  const dimensions = await verifyAiSceneV3GeneratedPng({ buffer: generated.buffer, contentType: generated.contentType, request: preflight.request });
  return { ...generated, dimensions, referenceIds: input.references.map((reference) => reference.id) };
}

export function aiSceneV3BackgroundPrompt(artDirection: DeckArtDirectionV3, brief: SlideSemanticBriefV3, plan: CompositionPlanV3) {
  return [
    "Create the final textless background layer for a premium 16:9 educational presentation slide.",
    `Use this art direction: ${artDirection.imagePromptFragment}`,
    `Main subject: ${plan.mainVisualSubject}. Composition: ${plan.compositionType}. Variant: ${plan.variant}.`,
    `Visual narrative: ${brief.visualNarrative}. Anchor regions: ${plan.anchorVisualRegions.map((region) => `${region.anchorId}=${region.visualRegion}`).join("; ")}.`,
    `Keep quiet native-text zones at ${plan.quietZones.map((zone) => `[${zone.x},${zone.y},${zone.w},${zone.h}]`).join(" ")}. They must be clear low-detail fields with no planets, orbits, image cards, lines, labels, high-contrast texture, frames, outlines, empty card-like placeholders, or decorative text containers.`,
    `Reserve these exact native overlay rectangles and leave them visually empty: ${plan.textZones.map((entry) => `${entry.semanticId}=[${entry.zone.x},${entry.zone.y},${entry.zone.w},${entry.zone.h}]`).join("; ")}.`,
    `Also leave the complete native backplate fields empty: ${plan.textZones.map((entry) => { const bounds = aiSceneV3NativeBackplateBounds({ semanticId: entry.semanticId, x: entry.zone.x * 1280, y: entry.zone.y * 720, w: entry.zone.w * 1280, h: entry.zone.h * 720 }); return `${entry.semanticId}=[${roundNormalised(bounds.x, 1280)},${roundNormalised(bounds.y, 720)},${roundNormalised(bounds.w, 1280)},${roundNormalised(bounds.h, 720)}]`; }).join("; ")}.`,
    `Keep meaningful imagery inside protected object zones and outside every native overlay rectangle: ${plan.protectedObjectZones.map((zone) => `[${zone.x},${zone.y},${zone.w},${zone.h}]`).join(" ") || "none"}.`,
    "Treat references as the quality, palette and composition bar only. Never copy their text, logos, branding, trade dress, exact subject matter, or layout.",
    "No text, letters, numbers, labels, symbols, logos, watermarks, captions, signatures, charts, UI panels, or readable marks anywhere. Never depict brand identifiers: no automotive badges, crests, emblems, monograms, distinctive grille marks, product marks, trademark-like shapes, or recognizable corporate design marks. Do not crop away any meaningful subject.",
  ].join("\n");
}

function roundNormalised(value: number, dimension: number) {
  return Math.round(value / dimension * 1000) / 1000;
}

function providerReadableUrl(value: string) {
  const url = value.trim();
  if (!/^https:\/\//i.test(url) && !/^data:image\/(?:png|jpeg);base64,[a-z0-9+/=]+$/i.test(url)) {
    throw new Error("ai_scene_v3_background_provider_readable_reference_required");
  }
  return url;
}
