import crypto from "node:crypto";

export type AiSceneV3SpeechSection = {
  slideId: string;
  slideOrder: number;
  title: string;
  text: string;
  kind: "cover" | "content";
  speechSectionHash: string;
};

type SlideLike = { id: string; order: number; title: string; speakerNotes: string };
type SpeechScriptLike = { slideOrder: number; slideTitle: string; text: string };

/**
 * Creates the only allowed mapping between approved speech and v3 slides.
 * It neither summarizes nor attempts to repair text: a mismatch is a hard
 * diagnostic, because a scene must never borrow narration from its neighbour.
 */
export function mapAiSceneV3SpeechSections(input: {
  slides: readonly SlideLike[];
  speechScript: readonly SpeechScriptLike[];
}): AiSceneV3SpeechSection[] {
  const slides = [...input.slides].sort((left, right) => left.order - right.order);
  if (!slides.length) throw new Error("ai_scene_v3_speech_sections_empty");
  if (slides.some((slide, index) => slide.order < 1 || (index > 0 && slide.order !== slides[index - 1]!.order + 1) || !clean(slide.id) || !clean(slide.title) || !clean(slide.speakerNotes))) {
    throw new Error("ai_scene_v3_slide_order_or_notes_invalid");
  }
  if (input.speechScript.length !== slides.length) throw new Error("ai_scene_v3_speech_section_count_mismatch");

  const scriptByOrder = new Map<number, SpeechScriptLike>();
  for (const section of input.speechScript) {
    if (!Number.isInteger(section.slideOrder) || section.slideOrder < 1 || scriptByOrder.has(section.slideOrder)) {
      throw new Error("ai_scene_v3_speech_section_order_mismatch");
    }
    scriptByOrder.set(section.slideOrder, section);
  }

  return slides.map((slide) => {
    const section = scriptByOrder.get(slide.order);
    if (!section || clean(section.text) !== clean(slide.speakerNotes) || clean(section.slideTitle) !== clean(slide.title)) {
      throw new Error(`ai_scene_v3_speech_section_content_mismatch:${slide.order}`);
    }
    const text = clean(section.text);
    return {
      slideId: slide.id,
      slideOrder: slide.order,
      title: slide.title.trim(),
      text,
      // A single-slide Gate 1 probe can intentionally target slide 2. Its
      // position in a filtered array must not turn it into a cover.
      kind: slide.order === 1 ? "cover" : "content",
      speechSectionHash: sha256({ slideId: slide.id, slideOrder: slide.order, title: slide.title.trim(), text }),
    };
  });
}

export function sha256(value: unknown) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
