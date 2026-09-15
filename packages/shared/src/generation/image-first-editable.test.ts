import { describe, expect, it } from "vitest";
import {
  IMAGE_FIRST_EDITABLE_V1_VERSION,
  hashAcceptedSpeech,
  imageFirstEditableDeckContentPlanSchema,
  imageFirstEditableFeatureEnabled,
  lockImageFirstEditableDeck,
  speechTraceForSection,
  validateImageFirstEditableEditableLineage,
  verifyImageFirstEditableLockHashes,
} from "./image-first-editable.js";

const sections = Array.from({ length: 6 }, (_, index) => ({ id: `speech-${index + 1}`, order: index + 1, text: `Раздел ${index + 1} объясняет проверяемый факт ${index + 1}.` }));
function plan(count = 6) {
  const selected = Array.from({ length: count }, (_, index) => ({ id: `speech-${(index % 6) + 1}`, order: (index % 6) + 1, text: `Раздел ${(index % 6) + 1} объясняет проверяемый факт ${(index % 6) + 1}.` }));
  return {
    version: IMAGE_FIRST_EDITABLE_V1_VERSION,
    requestedSlideCount: count as 6 | 8 | 10 | 12 | 14,
    acceptedSpeechHash: hashAcceptedSpeech(selected),
    sourceSnapshotHash: "a".repeat(64),
    visualFamilyIntent: "Спокойная editorial-композиция с цельной типографикой.",
    slides: selected.map((section, index) => ({
      slideId: `slide-${index + 1}`,
      order: index + 1,
      role: index === 0 ? "cover" : index === count - 1 ? "closing" : "content",
      title: { semanticId: `ife1:${index + 1}:title`, kind: "title", text: `Раздел ${section.order}`, speechTrace: speechTraceForSection(section) },
      theses: index === 0 ? [] : [{ semanticId: `ife1:${index + 1}:thesis:1`, kind: "thesis", text: `Раздел ${section.order} объясняет проверяемый факт ${section.order}.`, speechTrace: speechTraceForSection(section) }],
      visualIntent: "Редакционная композиция показывает смысл раздела без декоративного текста.",
      compositionArchetype: index % 2 ? "asymmetric_editorial" : "editorial_hero",
      renderMode: "image_text_lift",
    })),
  };
}

describe("image_first_editable_v1 shared contract", () => {
  it.each([6, 8, 10, 12, 14])("allows exactly %i slides including cover and closing", (count) => {
    const parsed = imageFirstEditableDeckContentPlanSchema.parse(plan(count));
    expect(parsed.slides).toHaveLength(count);
    expect(parsed.slides[0]?.role).toBe("cover");
    expect(parsed.slides.at(-1)?.role).toBe("closing");
  });

  it("rejects unsupported counts, duplicate semantic IDs, and padded empty content", () => {
    expect(() => imageFirstEditableDeckContentPlanSchema.parse({ ...plan(), requestedSlideCount: 7 })).toThrow();
    const duplicate = plan();
    duplicate.slides[2]!.theses[0]!.semanticId = duplicate.slides[1]!.theses[0]!.semanticId;
    expect(() => imageFirstEditableDeckContentPlanSchema.parse(duplicate)).toThrow(/semantic_ids_must_be_unique/);
    const empty = plan();
    empty.slides[1]!.theses = [];
    expect(() => imageFirstEditableDeckContentPlanSchema.parse(empty)).toThrow(/content_theses_1_to_4_required/);
  });

  it("keeps conclusion optional and hashes exact locked text", () => {
    const lock = lockImageFirstEditableDeck(plan());
    expect(lock.slides[1]?.conclusion).toBeUndefined();
    expect(verifyImageFirstEditableLockHashes(lock)).toBe(true);
    const changed = structuredClone(lock);
    changed.slides[1]!.theses[0]!.text = "Раздел 2 объясняет другой проверяемый факт 2.";
    expect(verifyImageFirstEditableLockHashes(changed)).toBe(false);
    const changedProvenance = structuredClone(lock);
    changedProvenance.slides[1]!.theses[0]!.provenance = { kind: "fallback_added" };
    expect(verifyImageFirstEditableLockHashes(changedProvenance)).toBe(false);
  });

  it("separates immutable generated lock from editable values", () => {
    const lock = lockImageFirstEditableDeck(plan());
    const values = { version: IMAGE_FIRST_EDITABLE_V1_VERSION, generatedContentHash: lock.contentHash, currentValues: [{ semanticId: lock.slides[1]!.theses[0]!.semanticId, text: "Пользовательская правка." }] } as const;
    expect(validateImageFirstEditableEditableLineage(lock, values)).toBe(true);
    expect(validateImageFirstEditableEditableLineage(lock, { ...values, generatedContentHash: "b".repeat(64) })).toBe(false);
  });

  it("is disabled unless its dedicated feature flag is exactly true", () => {
    expect(imageFirstEditableFeatureEnabled({})).toBe(false);
    expect(imageFirstEditableFeatureEnabled({ IMAGE_FIRST_EDITABLE_V1_ENABLED: "false" })).toBe(false);
    expect(imageFirstEditableFeatureEnabled({ IMAGE_FIRST_EDITABLE_V1_ENABLED: "true" })).toBe(true);
  });
});
