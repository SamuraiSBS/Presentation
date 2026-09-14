import { readFile } from "node:fs/promises";
import type { CompositionPlanV3, DeckArtDirectionV3, SlideSemanticBriefV3 } from "@studydeck/shared";
import { extractTextFromSource } from "../../extract.js";
import { validateAiSceneV3CompositionPair } from "./composition-planner.js";
import { AI_SCENE_V3_REFERENCE_PROFILES } from "./reference-library.js";
import { aiSceneV3SemanticBriefContentHash, buildAiSceneV3CompactGroundedAnchors, validateAiSceneV3SemanticBrief } from "./semantic-brief.js";
import { mapAiSceneV3SpeechSections, sha256 } from "./speech-section-map.js";

export type AiSceneV3Gate1Topic = {
  id: "solar_system" | "porsche_911" | "don_nature";
  profileId: "solar_scientific_dark" | "porsche_cinematic_dark" | "don_nature_light";
  docxPath: string;
  contentSlideOrder: number;
  referencePaths: readonly string[];
};

export type AiSceneV3Gate1Input = {
  id: AiSceneV3Gate1Topic["id"];
  profileId: AiSceneV3Gate1Topic["profileId"];
  slide: { id: string; order: number; title: string; speakerNotes: string };
  speechScript: { slideOrder: number; slideTitle: string; text: string }[];
  speechSectionHash: string;
  referencePaths: readonly string[];
};

export type AiSceneV3Gate1Preparation = {
  brief: SlideSemanticBriefV3;
  artDirection: DeckArtDirectionV3;
  plans: readonly [CompositionPlanV3, CompositionPlanV3];
};

/** Loads a real DOCX section for Gate 1; literal fallback speech is forbidden. */
export async function loadAiSceneV3Gate1Input(topic: AiSceneV3Gate1Topic): Promise<AiSceneV3Gate1Input> {
  if (!topic.docxPath.toLowerCase().endsWith(".docx") || topic.contentSlideOrder < 2 || topic.referencePaths.length < 1 || topic.referencePaths.length > 3) {
    throw new Error("ai_scene_v3_gate_1_fixture_configuration_invalid");
  }
  const text = await extractTextFromSource(topic.docxPath, await readFile(topic.docxPath));
  const sections = parseAiSceneV3DocxSections(text);
  const section = sections.find((item) => item.order === topic.contentSlideOrder);
  if (!section) throw new Error(`ai_scene_v3_gate_1_docx_section_missing:${topic.id}:${topic.contentSlideOrder}`);
  const slide = { id: `gate-1-${topic.id}-slide-${section.order}`, order: section.order, title: section.title, speakerNotes: section.text };
  const mapped = mapAiSceneV3SpeechSections({ slides: [slide], speechScript: [{ slideOrder: section.order, slideTitle: section.title, text: section.text }] })[0]!;
  if (mapped.kind !== "content") throw new Error("ai_scene_v3_gate_1_content_slide_required");
  return { id: topic.id, profileId: topic.profileId, slide, speechScript: [{ slideOrder: section.order, slideTitle: section.title, text: section.text }], speechSectionHash: mapped.speechSectionHash, referencePaths: topic.referencePaths };
}

/**
 * The free preflight and the paid runner must prepare exactly the same native
 * text contract. Validate its source trace and fixed-zone readability before
 * any provider capability request or image generation is allowed.
 */
export function prepareAiSceneV3Gate1Input(input: AiSceneV3Gate1Input): AiSceneV3Gate1Preparation {
  const compositionTypes = compositionTypesFor(input.id);
  const anchors = buildAiSceneV3CompactGroundedAnchors(input.slide.speakerNotes);
  const semanticDraft = {
    version: 3 as const,
    slideId: input.slide.id,
    slideOrder: input.slide.order,
    kind: "content" as const,
    speechSectionHash: input.speechSectionHash,
    title: { text: input.slide.title },
    anchors,
    visualNarrative: narrativeFor(input.id),
    allowedCompositionTypes: compositionTypes,
  };
  const brief = validateAiSceneV3SemanticBrief({
    ...semanticDraft,
    contentHash: aiSceneV3SemanticBriefContentHash(semanticDraft),
  }, {
    slideId: input.slide.id,
    slideOrder: input.slide.order,
    title: input.slide.title,
    kind: "content",
    text: input.slide.speakerNotes,
    speechSectionHash: input.speechSectionHash,
  });
  const artDirection = directionFor(input.id, input.profileId, compositionTypes, input.speechSectionHash);
  const plans = [
    compositionPlan(brief, "A", compositionTypes[0], input.id),
    compositionPlan(brief, "B", compositionTypes[1], input.id),
  ] as const;
  validateAiSceneV3CompositionPair(plans[0], plans[1], brief);
  return { brief, artDirection, plans };
}

export function parseAiSceneV3DocxSections(value: string) {
  const normalized = value.replace(/\r/g, "").replace(/\u00a0/g, " ").trim();
  const matches = [...normalized.matchAll(/(?:^|\n)Слайд\s+(\d+)\.\s*([^\n]+)\n+([\s\S]*?)(?=\n\s*Слайд\s+\d+\.|$)/g)];
  const sections = matches.map((match) => ({ order: Number(match[1]), title: clean(match[2] || ""), text: clean(match[3] || "") }));
  if (!sections.length || sections.some((section, index) => section.order !== index + 1 || !section.title || !section.text)) {
    throw new Error("ai_scene_v3_gate_1_docx_sections_invalid");
  }
  return sections;
}

function clean(value: string) { return value.replace(/\s+/g, " ").trim(); }

function directionFor(topic: string, profileId: AiSceneV3Gate1Topic["profileId"], compositionTypes: readonly CompositionPlanV3["compositionType"][], approvedSpeechHash: string): DeckArtDirectionV3 {
  const profile = AI_SCENE_V3_REFERENCE_PROFILES.find((item) => item.id === profileId);
  if (!profile) throw new Error("ai_scene_v3_gate_1_reference_profile_missing");
  return { version: 3, styleId: profile.id, styleVersion: 1, tone: profile.tone, palette: { background: profile.palette[0]!, surface: profile.palette[1]!, primaryText: profile.tone === "dark" ? "#FFFFFF" : "#1D2B20", secondaryText: profile.tone === "dark" ? "#DDEEFF" : "#34503C", accent: profile.palette[3] || profile.palette[2]! }, contrastRules: ["Keep native text at 70 or higher contrast."], typography: { primaryFontFamily: "Nunito", fallbackFontFamily: "Nunito", cyrillicSupported: true }, imageStyle: profile.imageCharacter, imageTreatmentRules: ["Use references only as visual language.", "Never bake text or brand identifiers into the background."], recurringMotifs: profile.successfulTechniques, slideNumberTreatment: "No slide number in raster background.", whitespaceRules: ["Reserve quiet zones for all native text."], allowedCompositionTypes: [...compositionTypes], adjacentSlideDiversityRules: ["A and B must use different composition types."], forbiddenTechniques: [...profile.forbiddenTransfers, "logos", "brand marks", "watermarks"], referenceProfileIds: [profile.id], imagePromptFragment: `${profile.imageCharacter} ${profile.successfulTechniques.join(", ")}`, topicHash: sha256(topic), approvedSpeechHash, referenceSelectionHash: sha256(profile.id) };
}

function compositionPlan(brief: SlideSemanticBriefV3, variant: "A" | "B", compositionType: CompositionPlanV3["compositionType"], topic: AiSceneV3Gate1Topic["id"]): CompositionPlanV3 {
  const isA = variant === "A";
  const ids = ["title", ...brief.anchors.map((anchor) => anchor.id)] as const;
  // The local Solar A evidence has a five-row text-field rhythm with roughly
  // 120px vertical intervals. Keep the native overlay on that same rhythm so
  // it cannot drift across a decorative field on an otherwise valid raster.
  // Solar A's former .03 position was only 38px on the 1280px canvas and
  // therefore failed the shared 48px text margin. Keep this retry fix scoped
  // to the authorised Solar System/A candidate. The backplate may extend into
  // the quiet field, but the actual native text box never does.
  const solarASafeTextX = topic === "solar_system" && isA ? .05 : .03;
  const columnX = isA ? solarASafeTextX : .51;
  const anchorX = isA ? solarASafeTextX : .54;
  const anchorY = [.235, .4, .565, .732];
  return { version: 3, slideId: brief.slideId, slideOrder: brief.slideOrder, variant, compositionType, mainVisualSubject: narrativeFor(topic), anchorVisualRegions: brief.anchors.map((anchor, index) => ({ anchorId: anchor.id, visualRegion: `distinct visual region ${index + 1}`, evidence: anchor.visualCue })), textZones: ids.map((semanticId, index) => semanticId === "title"
    ? { semanticId, zone: { x: columnX, y: .045, w: .443, h: .137 }, maxLines: 2 }
    : { semanticId, zone: { x: anchorX, y: anchorY[index - 1]!, w: .43, h: .095 }, maxLines: 2 }), quietZones: [{ x: isA ? .015 : .505, y: .04, w: .48, h: .80 }], protectedObjectZones: [{ x: isA ? .58 : .04, y: .08, w: isA ? .38 : .40, h: .84 }], cropRules: ["Do not crop the principal subject or anchor regions."], variantDifference: isA ? `Use ${compositionType} with a protected native-text column on the left.` : `Use ${compositionType} with a protected native-text column on the right; do not mirror variant A.` };
}

function compositionTypesFor(topic: AiSceneV3Gate1Topic["id"]): readonly [CompositionPlanV3["compositionType"], CompositionPlanV3["compositionType"]] {
  if (topic === "solar_system") return ["layered_explanation", "comparison"];
  if (topic === "porsche_911") return ["timeline", "hero_with_annotations"];
  return ["map", "process"];
}

function narrativeFor(topic: AiSceneV3Gate1Topic["id"]) {
  return topic === "solar_system" ? "A luminous Sun, distinct planets and clear orbital relationships." : topic === "porsche_911" ? "An unbranded classic rear-engine sports car lineage shown through shape and era, without badges or emblems." : "Rostov steppe plants in foreground with layered seasonal landscape and geographic depth.";
}
