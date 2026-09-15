import { describe, expect, it, vi } from "vitest";
import {
  IMAGE_FIRST_EDITABLE_V1_VERSION,
  hashAcceptedSpeech,
  speechTraceForSection,
  type AcceptedSpeechSection,
  type ImageFirstEditableDeckContentPlan,
} from "@studydeck/shared";
import {
  MissingAcceptedSpeechError,
  buildDeterministicImageFirstEditableLock,
  buildImageFirstEditableDeckContentPrompt,
  planImageFirstEditableDeck,
  validateImageFirstEditableDeckContentPlan,
} from "./content-planner.js";

function sections(count: number, wordsPerSection = Math.ceil(650 / count)): AcceptedSpeechSection[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `accepted-${index + 1}`,
    order: index + 1,
    text: [`Раздел ${index + 1} показывает проверяемый факт ${index + 1} и объясняет его значение для темы.`, ...Array.from({ length: Math.max(0, Math.ceil((wordsPerSection - 12) / 5)) }, () => "Детальное объяснение сохраняет связь с темой.")].join(" "),
  }));
}

function candidate(count: 6 | 8 | 10 | 12 | 14, accepted = sections(count)): ImageFirstEditableDeckContentPlan {
  return {
    version: IMAGE_FIRST_EDITABLE_V1_VERSION,
    requestedSlideCount: count,
    acceptedSpeechHash: hashAcceptedSpeech(accepted),
    sourceSnapshotHash: "a".repeat(64),
    visualFamilyIntent: "Спокойная editorial-композиция с цельной типографикой и ясной иерархией.",
    fallbackDiagnostics: [],
    slides: accepted.map((section, index) => ({
      slideId: `slide-${index + 1}`,
      order: index + 1,
      role: index === 0 ? "cover" : index === count - 1 ? "closing" : "content",
      title: { semanticId: `ife1:${index + 1}:title`, kind: "title", text: `Раздел ${index + 1} показывает проверяемый факт ${index + 1}.`, speechTrace: speechTraceForSection(section, `Раздел ${index + 1} показывает проверяемый факт ${index + 1} и объясняет его значение для темы.`), sourceRefs: [], provenance: { kind: "speech_grounded" } },
      theses: index === 0 ? [] : [{ semanticId: `ife1:${index + 1}:thesis:1`, kind: "thesis", text: `Раздел ${index + 1} показывает проверяемый факт ${index + 1} и объясняет его значение для темы.`, speechTrace: speechTraceForSection(section), sourceRefs: [], provenance: { kind: "speech_grounded" } }],
      semanticLabels: [],
      visualIntent: "Редакционная композиция раскрывает проверяемый смысл раздела без декоративного текста.",
      compositionArchetype: index % 2 ? "asymmetric_editorial" : "editorial_hero",
      renderMode: "image_text_lift",
    })),
  };
}

function compactButGroundedSpeech(count: 6 | 8 | 10 | 12 | 14): AcceptedSpeechSection[] {
  const requiredStrings = (2 * count) - 2;
  return [{
    id: "accepted-compact",
    order: 1,
    // One typographic sentence can contain many independent, complete claims.
    // The semicolons are source-grounded clause boundaries, not a request to
    // repeat or paraphrase a claim just to meet the requested deck count.
    text: Array.from({ length: requiredStrings }, (_, index) => `Понятие ${index + 1} сохраняет отдельный проверяемый смысл для краткого объяснения${index === requiredStrings - 1 ? "." : ";"}`).join(" "),
  }];
}

describe("image_first_editable_v1 deck-wide content planner", () => {
  it.each([6, 14] as const)("makes one model call and returns exactly %i locked slides", async (count) => {
    const accepted = sections(count);
    const generate = vi.fn().mockResolvedValue(candidate(count, accepted));
    const result = await planImageFirstEditableDeck({ requestedSlideCount: count, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] }, { generate });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.modelCallCount).toBe(1);
    expect(result.usedDeterministicFallback).toBe(false);
    expect(result.lock.slides).toHaveLength(count);
    expect(result.lock.slides[0]?.role).toBe("cover");
    expect(result.lock.slides.at(-1)?.role).toBe("closing");
    expect(generate.mock.calls[0]?.[0].prompt).toContain("SECTION 1");
    expect(generate.mock.calls[0]?.[0].prompt).toContain(`SECTION ${count}`);
    const wordCount = accepted.map((section) => section.text).join(" ").split(/\s+/u).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(600);
    expect(wordCount).toBeLessThanOrEqual(800);
  });

  it.each([6, 8, 10, 12, 14] as const)("uses compact accepted speech to create exactly %i unique grounded slides without retry or source-only content", async (count) => {
    const accepted = compactButGroundedSpeech(count);
    const generate = vi.fn().mockResolvedValue({ invalid: true });
    const sourceOnly = { sourceId: "external-check", excerpt: "Внешний источник добавляет новый факт, которого нет в принятой речи." };
    const input = { requestedSlideCount: count, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [sourceOnly] };
    const result = await planImageFirstEditableDeck(input, { generate });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.modelCallCount).toBe(1);
    expect(result.usedDeterministicFallback).toBe(true);
    expect(result.lock.slides).toHaveLength(count);
    const visible = result.lock.slides.flatMap((slide) => [slide.title, ...slide.theses].map((entry) => entry.text));
    expect(new Set(visible.map((value) => value.toLowerCase())).size).toBe(visible.length);
    expect(validateImageFirstEditableDeckContentPlan({ ...result.lock, slides: result.lock.slides.map(({ contentHash: _hash, ...slide }) => slide) }, input)).toEqual([]);
    for (const slide of result.lock.slides) {
      for (const entry of [slide.title, ...slide.theses]) {
        const matching = accepted.find((section) => section.id === entry.speechTrace.sectionId)!;
        expect(matching.text).toContain(entry.speechTrace.excerpt);
        expect(entry.sourceRefs).toEqual([]);
      }
    }
    expect(visible.join(" ")).not.toContain(sourceOnly.excerpt);
  });

  it("returns all 10 slides with provenance-marked repeated grounded lines when only two unique claims are available", async () => {
    const accepted = [
      { id: "accepted-1", order: 1, text: "Первый раздел объясняет один проверяемый факт без добавления нового смысла." },
      { id: "accepted-2", order: 2, text: "Второй раздел объясняет другой проверяемый факт без добавления нового смысла." },
    ];
    const generate = vi.fn().mockResolvedValue({ invalid: true });
    const result = await planImageFirstEditableDeck({ requestedSlideCount: 10, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] }, { generate });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.lock.slides).toHaveLength(10);
    expect(result.lock.slides[0]?.role).toBe("cover");
    expect(result.lock.slides.at(-1)?.role).toBe("closing");
    expect(result.usedDeterministicFallback).toBe(true);
    expect(result.lock.fallbackDiagnostics).toEqual(expect.arrayContaining([
      "deterministic_content_lock_fallback",
      "exact_count_fulfilled_with_repeated_grounded_lines",
      "unique_grounded_statements:2",
      "required_semantic_strings:18",
    ]));
    const repeated = result.lock.slides.flatMap((slide) => [slide.title, ...slide.theses]).filter((entry) => entry.provenance.kind === "repeated_accepted_speech");
    expect(repeated).not.toHaveLength(0);
    for (const entry of repeated) {
      expect(entry.provenance.repeatedFromSemanticId).toMatch(/^ife1:/);
      expect(entry.speechTrace.excerpt).toContain(entry.text.replace(/\.$/u, ""));
    }
    expect(validateImageFirstEditableDeckContentPlan({ ...result.lock, slides: result.lock.slides.map(({ contentHash: _hash, ...slide }) => slide) }, { requestedSlideCount: 10, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] })).toEqual([]);
  });

  it("rejects invented numeric facts, fragments, and unsupported conclusions", () => {
    const accepted = sections(6);
    const invalid = candidate(6, accepted);
    invalid.slides[1]!.theses[0]!.text = "Раздел 2 показывает проверяемый факт 999";
    invalid.slides[2]!.theses[0]!.text = "Раздел 3 показывает:";
    invalid.slides[5]!.conclusion = { semanticId: "ife1:6:conclusion", kind: "conclusion", text: "Раздел 6 показывает проверяемый факт 6 и объясняет его значение для темы.", speechTrace: speechTraceForSection(accepted[5]!), sourceRefs: [], provenance: { kind: "speech_grounded" } };
    const diagnostics = validateImageFirstEditableDeckContentPlan(invalid, { requestedSlideCount: 6, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] });
    expect(diagnostics.join(" ")).toContain("not_grounded_in_matching_speech");
    expect(diagnostics.join(" ")).toContain("incomplete_phrase");
    expect(diagnostics.join(" ")).toContain("unsupported_conclusion");
  });

  it("rejects a non-numeric invented claim even when two lexical tokens overlap", () => {
    const accepted = sections(6);
    const invalid = candidate(6, accepted);
    invalid.slides[1]!.theses[0]!.text = "Раздел 2 связывает риск с катастрофой.";
    const diagnostics = validateImageFirstEditableDeckContentPlan(invalid, { requestedSlideCount: 6, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] });
    expect(diagnostics).toContain("ife1:2:thesis:1:not_grounded_in_matching_speech");
  });

  it("rejects any repeated visible semantic string, not only repeated theses", () => {
    const accepted = sections(6);
    const invalid = candidate(6, accepted);
    invalid.slides[1]!.title.text = invalid.slides[0]!.title.text;
    invalid.slides[1]!.title.speechTrace = speechTraceForSection(accepted[0]!);
    const diagnostics = validateImageFirstEditableDeckContentPlan(invalid, { requestedSlideCount: 6, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] });
    expect(diagnostics).toContain("ife1:2:title:duplicate_visible_semantic_string");
  });

  it("rejects source-only visible copy when its matching speech section does not say it", () => {
    const accepted = sections(6);
    const invalid = candidate(6, accepted);
    invalid.slides[1]!.theses[0]!.text = "Внешний источник подтверждает уникальную гипотезу.";
    invalid.slides[1]!.theses[0]!.sourceRefs = [{ sourceId: "source-only", excerpt: "Внешний источник подтверждает уникальную гипотезу." }];
    const diagnostics = validateImageFirstEditableDeckContentPlan(invalid, {
      requestedSlideCount: 6,
      acceptedSpeechSections: accepted,
      sourceSnapshotHash: "a".repeat(64),
      sourceRefs: [{ sourceId: "source-only", excerpt: "Внешний источник подтверждает уникальную гипотезу." }],
    });
    expect(diagnostics).toContain("ife1:2:thesis:1:not_grounded_in_matching_speech");
  });

  it("rejects a candidate source ref that does not belong to the supplied input refs", () => {
    const accepted = sections(6);
    const invalid = candidate(6, accepted);
    invalid.slides[1]!.theses[0]!.sourceRefs = [{ sourceId: "known-source", excerpt: "Подменённый источник подтверждает текст." }];
    const diagnostics = validateImageFirstEditableDeckContentPlan(invalid, {
      requestedSlideCount: 6,
      acceptedSpeechSections: accepted,
      sourceSnapshotHash: "a".repeat(64),
      sourceRefs: [{ sourceId: "known-source", excerpt: "Разрешённый источник подтверждает текст." }],
    });
    expect(diagnostics).toContain("ife1:2:thesis:1:source_ref_not_in_input");
  });

  it("uses explicitly marked non-speech fallback lines rather than blocking when no complete claim can be extracted", () => {
    const accepted = [{ id: "accepted-1", order: 1, text: "Тема" }];
    const lock = buildDeterministicImageFirstEditableLock({ requestedSlideCount: 6, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] });
    expect(lock.slides).toHaveLength(6);
    expect(lock.fallbackDiagnostics).toContain("exact_count_fulfilled_with_fallback_added_lines");
    expect(lock.slides.flatMap((slide) => [slide.title, ...slide.theses]).every((entry) => entry.provenance.kind === "fallback_added")).toBe(true);
  });

  it("requires native evidence for a precise table, graph, or formula", () => {
    const accepted = sections(6);
    const table = candidate(6, accepted);
    table.slides[1]!.visualIntent = "Точная таблица связывает показатели раздела с проверяемыми значениями.";
    expect(validateImageFirstEditableDeckContentPlan(table, { requestedSlideCount: 6, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] })).toContain("slide-2:native_evidence_required");
    table.slides[1]!.renderMode = "native_evidence";
    expect(validateImageFirstEditableDeckContentPlan(table, { requestedSlideCount: 6, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] })).not.toContain("slide-2:native_evidence_required");
  });

  it("stops before any model or image stage when accepted speech is absent", async () => {
    const generate = vi.fn();
    await expect(planImageFirstEditableDeck({ requestedSlideCount: 6, acceptedSpeechSections: [], sourceSnapshotHash: "a".repeat(64), sourceRefs: [] }, { generate })).rejects.toBeInstanceOf(MissingAcceptedSpeechError);
    expect(generate).not.toHaveBeenCalled();
  });

  it("builds a prompt from the complete accepted speech rather than a prefix", () => {
    const accepted = sections(6);
    const prompt = buildImageFirstEditableDeckContentPrompt({ requestedSlideCount: 6, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] });
    expect(prompt).toContain(accepted[0]!.text);
    expect(prompt).toContain(accepted[5]!.text);
    expect(prompt).toContain("Do not take the first N sentences");
  });

  it("keeps an exact requested count for excess accepted speech without font-size directives", async () => {
    const accepted = sections(6, 220);
    const generate = vi.fn().mockResolvedValue(candidate(6, accepted));
    const result = await planImageFirstEditableDeck({ requestedSlideCount: 6, acceptedSpeechSections: accepted, sourceSnapshotHash: "a".repeat(64), sourceRefs: [] }, { generate });
    expect(result.lock.slides).toHaveLength(6);
    expect(JSON.stringify(result.lock)).not.toMatch(/fontSize|font_size/);
  });
});
