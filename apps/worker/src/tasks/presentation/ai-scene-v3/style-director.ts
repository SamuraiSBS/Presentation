import {
  deckArtDirectionV3Schema,
  PRESENTATION_FONT_FAMILY,
  type DeckArtDirectionV3,
  type SlideSemanticBriefV3,
} from "@studydeck/shared";
import { sha256 } from "./speech-section-map.js";
import type { AiSceneV3ReferenceLibraryManifest } from "./reference-library.js";

/** Validates the one deck-wide style decision returned by Luna. */
export function validateAiSceneV3DeckArtDirection(input: {
  value: unknown;
  topic: string;
  approvedSpeechHash: string;
  referenceManifest: AiSceneV3ReferenceLibraryManifest;
}) {
  const artDirection = deckArtDirectionV3Schema.parse(input.value);
  if (artDirection.typography.primaryFontFamily !== PRESENTATION_FONT_FAMILY || artDirection.typography.fallbackFontFamily !== PRESENTATION_FONT_FAMILY) {
    throw new Error("ai_scene_v3_art_direction_export_font_required");
  }
  if (artDirection.topicHash !== sha256(input.topic)) throw new Error("ai_scene_v3_art_direction_topic_hash_mismatch");
  if (artDirection.approvedSpeechHash !== input.approvedSpeechHash) throw new Error("ai_scene_v3_art_direction_speech_hash_mismatch");
  const selectedReferences = input.referenceManifest.assets.filter((asset) => artDirection.referenceProfileIds.includes(asset.profileId));
  if (!selectedReferences.length) throw new Error("ai_scene_v3_art_direction_reference_profiles_missing");
  const selectionHash = sha256(selectedReferences.map((asset) => ({ id: asset.id, profileId: asset.profileId, optimizedHash: asset.optimizedHash })));
  if (artDirection.referenceSelectionHash !== selectionHash) throw new Error("ai_scene_v3_art_direction_reference_hash_mismatch");
  return artDirection;
}

export function aiSceneV3DeckArtDirectionPrompt(input: {
  topic: string;
  audience: string;
  briefs: readonly SlideSemanticBriefV3[];
  referenceManifest: AiSceneV3ReferenceLibraryManifest;
}) {
  return [
    "Return JSON only for DeckArtDirectionV3 version 3. Make one coherent deck direction, not per-slide coordinates.",
    `Select only supplied reference profile IDs. Use ${PRESENTATION_FONT_FAMILY} as both primaryFontFamily and fallbackFontFamily so preview, PDF and PPTX share one export-safe Cyrillic font. Specify contrast and whitespace rules, composition diversity rules, and forbidden techniques.`,
    "Never request copied reference text, branding, logos, brand marks, badges, crests, emblems, watermarks, UI-card grids, or baked text in backgrounds.",
    `Topic: ${input.topic}. Audience: ${input.audience}.`,
    `Reference profiles: ${JSON.stringify(input.referenceManifest.profiles)}`,
    `Slide briefs: ${JSON.stringify(input.briefs)}`,
  ].join("\n");
}
