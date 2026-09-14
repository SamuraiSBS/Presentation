import type { CompositionPlanV3, DeckArtDirectionV3, SlideSemanticBriefV3, TextLayoutV3 } from "@studydeck/shared";
import { mapAiSceneV3SpeechSections, sha256, type AiSceneV3SpeechSection } from "./speech-section-map.js";
import { validateAiSceneV3SemanticBrief } from "./semantic-brief.js";
import { validateAiSceneV3DeckArtDirection } from "./style-director.js";
import { validateAiSceneV3CompositionPair } from "./composition-planner.js";
import { validateAiSceneV3TextLayout } from "./text-layout-analyzer.js";
import type { AiSceneV3ReferenceLibraryManifest } from "./reference-library.js";

/**
 * Pure non-billable part of the v3 orchestration. The provider driver is
 * injected by a separately authorized job; this routine makes a failed
 * structured output stop the whole slide rather than inventing a fallback.
 */
export async function prepareAiSceneV3Deck(input: {
  topic: string;
  audience: string;
  slides: readonly { id: string; order: number; title: string; speakerNotes: string }[];
  speechScript: readonly { slideOrder: number; slideTitle: string; text: string }[];
  referenceManifest: AiSceneV3ReferenceLibraryManifest;
  provider: {
    semanticBrief(section: AiSceneV3SpeechSection): Promise<unknown>;
    artDirection(briefs: readonly SlideSemanticBriefV3[]): Promise<unknown>;
    composition(brief: SlideSemanticBriefV3, variant: "A" | "B", direction: DeckArtDirectionV3): Promise<unknown>;
    textLayout(brief: SlideSemanticBriefV3, plan: CompositionPlanV3, direction: DeckArtDirectionV3): Promise<unknown>;
  };
}) {
  const sections = mapAiSceneV3SpeechSections({ slides: input.slides, speechScript: input.speechScript });
  const briefs = await Promise.all(sections.map(async (section) => validateAiSceneV3SemanticBrief(await input.provider.semanticBrief(section), section)));
  const approvedSpeechHash = sha256(sections.map((section) => section.speechSectionHash));
  const artDirection = validateAiSceneV3DeckArtDirection({ value: await input.provider.artDirection(briefs), topic: input.topic, approvedSpeechHash, referenceManifest: input.referenceManifest });
  const slides = [] as Array<{ section: AiSceneV3SpeechSection; brief: SlideSemanticBriefV3; plans: readonly [CompositionPlanV3, CompositionPlanV3]; layouts: readonly [TextLayoutV3, TextLayoutV3] }>;
  for (const [index, brief] of briefs.entries()) {
    const [a, b] = validateAiSceneV3CompositionPair(
      await input.provider.composition(brief, "A", artDirection),
      await input.provider.composition(brief, "B", artDirection),
      brief,
    );
    const layouts = [
      validateAiSceneV3TextLayout({ value: await input.provider.textLayout(brief, a, artDirection), brief, plan: a, artDirection }),
      validateAiSceneV3TextLayout({ value: await input.provider.textLayout(brief, b, artDirection), brief, plan: b, artDirection }),
    ] as const;
    slides.push({ section: sections[index]!, brief, plans: [a, b], layouts });
  }
  return { sections, briefs, artDirection, slides, approvedSpeechHash };
}

/** A feature flag defaults to off; no current project enters v3 accidentally. */
export function aiSceneV3Enabled(env: Record<string, string | undefined> = process.env) {
  return env.AI_SCENE_V3_ENABLED?.trim().toLowerCase() === "true";
}
