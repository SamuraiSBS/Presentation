import {
  IMAGE_FIRST_EDITABLE_V1_VERSION,
  hashAcceptedSpeech,
  hashImageFirstEditableValue,
  imageFirstEditableDeckContentPlanSchema,
  lockImageFirstEditableDeck,
  speechTraceForSection,
  type AcceptedSpeechSection,
  type ImageFirstEditableDeckContentLock,
  type ImageFirstEditableDeckContentPlan,
  type ImageFirstEditableSlideCount,
  type ImageFirstEditableSourceRef,
} from "@studydeck/shared";

export type DeckContentPlannerAdapter = {
  generate(input: { prompt: string; schemaName: "studydeck_image_first_editable_v1_deck_content_lock" }): Promise<unknown>;
};

export type DeckContentPlannerInput = {
  requestedSlideCount: ImageFirstEditableSlideCount;
  acceptedSpeechSections: readonly AcceptedSpeechSection[];
  sourceSnapshotHash: string;
  sourceRefs: readonly ImageFirstEditableSourceRef[];
};

export type DeckContentPlannerResult = {
  lock: ImageFirstEditableDeckContentLock;
  modelCallCount: 0 | 1;
  diagnostics: string[];
  usedDeterministicFallback: boolean;
};

/**
 * This is intentionally a one-call adapter. It has no provider selection and
 * no repair callback: an invalid or timed-out result falls back locally so it
 * cannot make an unapproved second paid call.
 */
export async function planImageFirstEditableDeck(input: DeckContentPlannerInput, adapter: DeckContentPlannerAdapter): Promise<DeckContentPlannerResult> {
  const sections = validateAcceptedSpeech(input.acceptedSpeechSections);
  const prompt = buildImageFirstEditableDeckContentPrompt({ ...input, acceptedSpeechSections: sections });
  try {
    const raw = await adapter.generate({ prompt, schemaName: "studydeck_image_first_editable_v1_deck_content_lock" });
    const candidate = imageFirstEditableDeckContentPlanSchema.parse(raw);
    const diagnostics = validateImageFirstEditableDeckContentPlan(candidate, input);
    if (diagnostics.length) throw new InvalidDeckContentPlanError(diagnostics);
    return { lock: lockImageFirstEditableDeck(candidate), modelCallCount: 1, diagnostics: [], usedDeterministicFallback: false };
  } catch (error) {
    const diagnostics = error instanceof InvalidDeckContentPlanError
      ? error.diagnostics
      : [`model_result_invalid:${safeErrorCode(error)}`];
    return {
      lock: buildDeterministicImageFirstEditableLock(input, sections),
      modelCallCount: 1,
      diagnostics: ["deterministic_content_lock_fallback", ...diagnostics],
      usedDeterministicFallback: true,
    };
  }
}

export function buildImageFirstEditableDeckContentPrompt(input: DeckContentPlannerInput) {
  const speech = input.acceptedSpeechSections
    .map((section) => `SECTION ${section.order} (${section.id})\n${normalise(section.text)}`)
    .join("\n\n");
  return [
    "Return exactly one JSON object for image_first_editable_v1. It is one deck-wide content-lock plan, never one response per slide.",
    `requestedSlideCount: ${input.requestedSlideCount}; first role cover; last role closing; exactly that many ordered slides.`,
    "Use short complete Russian slide text. Do not take the first N sentences, do not cut a line to a character limit, do not use slogans or microtext.",
    "Every visible title, thesis, conclusion, date, number, name, term, and caption needs a unique ife1: semanticId and a matching speechTrace to the supplied accepted-speech section. Sources verify speech facts only; they never add visible facts.",
    "Content slides have one to four theses only when their section needs them. conclusion is optional and is allowed only for a real result stated in its section.",
    "Choose one visualFamilyIntent for the deck and varied compositionArchetype values. Exact tables, charts, formulas, numeric labels, and precise schemas use renderMode native_evidence; other illustration slides use image_text_lift.",
    `acceptedSpeechHash: ${hashAcceptedSpeech(input.acceptedSpeechSections)}`,
    `sourceSnapshotHash: ${input.sourceSnapshotHash}`,
    `availableSourceRefs: ${JSON.stringify(input.sourceRefs)}`,
    "accepted speech:",
    speech,
  ].join("\n");
}

export function validateImageFirstEditableDeckContentPlan(candidate: ImageFirstEditableDeckContentPlan, input: DeckContentPlannerInput) {
  const diagnostics: string[] = [];
  const sections = new Map(validateAcceptedSpeech(input.acceptedSpeechSections).map((section) => [section.id, section]));
  if (candidate.acceptedSpeechHash !== hashAcceptedSpeech(input.acceptedSpeechSections)) diagnostics.push("accepted_speech_hash_mismatch");
  if (candidate.sourceSnapshotHash !== input.sourceSnapshotHash) diagnostics.push("source_snapshot_hash_mismatch");
  if (candidate.requestedSlideCount !== input.requestedSlideCount) diagnostics.push("requested_slide_count_mismatch");
  const theses = new Map<string, string>();
  const visibleStrings = new Map<string, string>();
  const archetypes = new Set<string>();
  for (const slide of candidate.slides) {
    archetypes.add(slide.compositionArchetype);
    const entries = [slide.title, ...slide.theses, ...(slide.conclusion ? [slide.conclusion] : []), ...slide.semanticLabels];
    for (const entry of entries) {
      const visibleKey = normalise(entry.text).toLocaleLowerCase();
      const originalSemanticId = visibleStrings.get(visibleKey);
      if (originalSemanticId && (entry.provenance.kind !== "repeated_accepted_speech" || entry.provenance.repeatedFromSemanticId !== originalSemanticId)) {
        diagnostics.push(`${entry.semanticId}:duplicate_visible_semantic_string`);
      }
      if (!originalSemanticId) visibleStrings.set(visibleKey, entry.semanticId);
      if (entry.sourceRefs.some((sourceRef) => !input.sourceRefs.some((available) => available.sourceId === sourceRef.sourceId && normalise(available.excerpt) === normalise(sourceRef.excerpt)))) {
        diagnostics.push(`${entry.semanticId}:source_ref_not_in_input`);
      }
      const section = sections.get(entry.speechTrace.sectionId);
      if (!section || section.order !== entry.speechTrace.sectionOrder) {
        diagnostics.push(`${entry.semanticId}:speech_section_missing`);
        continue;
      }
      const sourceText = normalise(section.text);
      if (entry.speechTrace.sectionHash !== hashImageFirstEditableValue(sourceText) || !sourceText.includes(normalise(entry.speechTrace.excerpt))) diagnostics.push(`${entry.semanticId}:speech_trace_invalid`);
      if (entry.provenance.kind === "fallback_added") {
        if (entry.sourceRefs.length) diagnostics.push(`${entry.semanticId}:fallback_added_must_not_claim_source_ref`);
        if (!isAllowedFallbackAddedText(entry.text)) diagnostics.push(`${entry.semanticId}:fallback_added_text_invalid`);
      } else if (!isGroundedText(entry.text, sourceText, normalise(entry.speechTrace.excerpt), entry.kind)) {
        diagnostics.push(`${entry.semanticId}:not_grounded_in_matching_speech`);
      }
      if (hasIncompletePhrase(entry.text)) diagnostics.push(`${entry.semanticId}:incomplete_phrase`);
      if (hasPromptEchoOrFiller(entry.text)) diagnostics.push(`${entry.semanticId}:prompt_echo_or_generic_filler`);
      if (entry.kind === "conclusion" && !hasConclusionSupport(sourceText)) diagnostics.push(`${entry.semanticId}:unsupported_conclusion`);
    }
    for (const thesis of slide.theses) {
      const key = normalise(thesis.text).toLowerCase();
      const originalSemanticId = theses.get(key);
      if (originalSemanticId && thesis.provenance.kind !== "repeated_accepted_speech") {
        diagnostics.push(`${thesis.semanticId}:duplicate_thesis`);
      }
      if (!originalSemanticId) theses.set(key, thesis.semanticId);
    }
    if (requiresNativeEvidence([slide.visualIntent, slide.title.text, ...slide.theses.map((thesis) => thesis.text)]) && slide.renderMode !== "native_evidence") diagnostics.push(`${slide.slideId}:native_evidence_required`);
  }
  if (archetypes.size < 2) diagnostics.push("composition_diversity_required");
  if (/\b(?:dashboard|pill|ui[ -]?card|glassmorphism)\b/iu.test(candidate.visualFamilyIntent)) diagnostics.push("visual_family_forbidden_ui_pattern");
  return [...new Set(diagnostics)];
}

export function buildDeterministicImageFirstEditableLock(input: DeckContentPlannerInput, suppliedSections = validateAcceptedSpeech(input.acceptedSpeechSections)) {
  if (!suppliedSections.length) throw new MissingAcceptedSpeechError();
  const statements = uniqueCompleteGroundedStatements(suppliedSections);
  const requiredSemanticStrings = (2 * input.requestedSlideCount) - 2;
  const fallbackDiagnostics = statements.length
    ? ["deterministic_content_lock_fallback", "exact_count_fulfilled_with_repeated_grounded_lines", `unique_grounded_statements:${statements.length}`, `required_semantic_strings:${requiredSemanticStrings}`]
    : ["deterministic_content_lock_fallback", "exact_count_fulfilled_with_fallback_added_lines", "unique_grounded_statements:0", `required_semantic_strings:${requiredSemanticStrings}`];
  const firstSemanticIdByStatement = new Map<number, string>();
  let semanticStringIndex = 0;
  const nextEntry = (semanticId: string, kind: "title" | "thesis") => {
    const statementIndex = statements.length ? semanticStringIndex % statements.length : -1;
    semanticStringIndex += 1;
    if (statementIndex < 0) {
      const section = suppliedSections[(semanticStringIndex - 1) % suppliedSections.length]!;
      return { semanticId, kind, text: fallbackAddedText(semanticStringIndex), speechTrace: speechTraceForSection(section), sourceRefs: [], provenance: { kind: "fallback_added" as const } };
    }
    const statement = statements[statementIndex]!;
    const repeatedFromSemanticId = firstSemanticIdByStatement.get(statementIndex);
    if (!repeatedFromSemanticId) firstSemanticIdByStatement.set(statementIndex, semanticId);
    return {
      semanticId,
      kind,
      text: statement.text,
      speechTrace: speechTraceForSection(statement.section, statement.excerpt),
      sourceRefs: [],
      provenance: repeatedFromSemanticId ? { kind: "repeated_accepted_speech" as const, repeatedFromSemanticId } : { kind: "speech_grounded" as const },
    };
  };
  const slides = Array.from({ length: input.requestedSlideCount }, (_, index) => {
    const role = index === 0 ? "cover" as const : index === input.requestedSlideCount - 1 ? "closing" as const : "content" as const;
    const title = nextEntry(`ife1:${index + 1}:title`, "title");
    const thesis = role === "content" ? nextEntry(`ife1:${index + 1}:thesis:1`, "thesis") : undefined;
    const functionIntent = deterministicContractFunction(index, input.requestedSlideCount);
    return {
      slideId: `ife1-slide-${index + 1}`,
      order: index + 1,
      role,
      title,
      theses: thesis ? [thesis] : [],
      semanticLabels: [],
      visualIntent: functionIntent,
      compositionArchetype: (["editorial_hero", "asymmetric_editorial", "typographic_pause", "process"] as const)[index % 4]!,
      renderMode: requiresNativeEvidence([title.text, ...(thesis ? [thesis.text] : [])]) ? "native_evidence" as const : "image_text_lift" as const,
    };
  });
  const plan = imageFirstEditableDeckContentPlanSchema.parse({
    version: IMAGE_FIRST_EDITABLE_V1_VERSION,
    requestedSlideCount: input.requestedSlideCount,
    acceptedSpeechHash: hashAcceptedSpeech(suppliedSections),
    sourceSnapshotHash: input.sourceSnapshotHash,
    visualFamilyIntent: "Единая спокойная editorial visual family с разным ритмом композиции.",
    fallbackDiagnostics,
    slides,
  });
  const diagnostics = validateImageFirstEditableDeckContentPlan(plan, { ...input, acceptedSpeechSections: suppliedSections });
  if (diagnostics.length) throw new PreImageContentBlockerError("deterministic_content_lock_invalid", diagnostics);
  return lockImageFirstEditableDeck(plan);
}

export class MissingAcceptedSpeechError extends Error {
  constructor(message = "accepted_speech_required_before_image_first_editable_planning") { super(message); this.name = "MissingAcceptedSpeechError"; }
}

/** Reserved for pre-image failures other than exact-count scarcity. */
export class PreImageContentBlockerError extends Error {
  constructor(message: string, readonly diagnostics: string[] = []) { super(message); this.name = "PreImageContentBlockerError"; }
}

class InvalidDeckContentPlanError extends Error {
  constructor(readonly diagnostics: string[]) { super("image_first_editable_v1_content_plan_invalid"); }
}

function validateAcceptedSpeech(sections: readonly AcceptedSpeechSection[]) {
  const ordered = [...sections].sort((left, right) => left.order - right.order);
  if (!ordered.length || ordered.some((section, index) => !section.id.trim() || !normalise(section.text) || section.order !== index + 1)) throw new MissingAcceptedSpeechError();
  return ordered;
}

function isGroundedText(text: string, section: string, excerpt: string, kind: string) {
  const visible = meaningfulTokens(text);
  const source = new Set(meaningfulTokens(section));
  const traced = new Set(meaningfulTokens(excerpt));
  const numericValues = text.match(/\d+(?:[.,]\d+)?%?/gu) || [];
  if (numericValues.some((value) => !section.includes(value) || !excerpt.includes(value))) return false;
  if (!visible.length) return false;
  // A date, number, name, or term can legitimately be one lexical token, but
  // a visible claim needs at least three and every meaningful token must be
  // grounded in its concrete trace.  Two coincident words are not evidence for
  // a new assertion, even if a source ref happens to contain that assertion.
  if (["date", "number", "name", "term"].includes(kind) && visible.length === 1) {
    return source.has(visible[0]!) && traced.has(visible[0]!);
  }
  return visible.length >= 3 && visible.every((token) => source.has(token) && traced.has(token));
}

function meaningfulTokens(value: string) {
  const stop = new Set(["и", "в", "во", "на", "по", "для", "с", "из", "к", "это", "этот", "такая", "такой", "что", "как", "не", "а", "но", "или", "the", "and"]);
  return (normalise(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((token) => token.length > 1 && !stop.has(token));
}

function hasIncompletePhrase(value: string) { return /(?:[…]|[,:;—-])$/u.test(normalise(value)) || /\b(?:и|или|но|для|по|в|на|с|из)$/iu.test(normalise(value)); }
function hasPromptEchoOrFiller(value: string) { return /\b(?:as an ai|json|system prompt|слайд\s*\d+|важно помнить|следует отметить)\b/iu.test(value); }
function hasConclusionSupport(section: string) { return /\b(?:вывод|итог|следовательно|таким образом|в результате|значит)\b/iu.test(section); }
function requiresNativeEvidence(values: readonly string[]) { return /(?:таблиц|таблица|график|диаграмм|формул|формула|уравнен|схем|chart|table|formula|equation)/iu.test(values.join(" ")); }
function uniqueCompleteGroundedStatements(sections: readonly AcceptedSpeechSection[]) {
  const seen = new Set<string>();
  const statements: Array<{ section: AcceptedSpeechSection; text: string; excerpt: string }> = [];
  for (const section of sections) {
    for (const sentence of normalise(section.text).split(/(?<=[.!?])\s+/u).map(normalise)) {
      const clauses = semicolonSeparatedStatements(sentence);
      for (const statement of clauses) {
        const key = statement.text.toLocaleLowerCase();
        if (!isCompleteGroundedSentence(statement.text) || seen.has(key)) continue;
        seen.add(key);
        statements.push({ section, ...statement });
      }
    }
  }
  return statements;
}
function semicolonSeparatedStatements(sentence: string) {
  const clauses = sentence.split(/(?<=;)\s+/u).map(normalise).filter(Boolean);
  if (clauses.length < 2 || clauses.some((clause) => !hasIndependentClauseShape(clause))) {
    return [{ text: sentence, excerpt: sentence }];
  }
  return clauses.map((clause) => ({
    text: clause.replace(/;$/u, "."),
    excerpt: clause,
  }));
}
function hasIndependentClauseShape(value: string) {
  const withoutTerminal = value.replace(/[.;!?]$/u, "");
  return withoutTerminal.length >= 12
    && /[\p{L}]{3,}/u.test(withoutTerminal)
    // Do not use \b here: JavaScript word boundaries are ASCII-oriented and
    // would reject otherwise valid Cyrillic predicates.
    && /(?:ет|ют|ит|ят|ает|яют|ется|ются|является|означает|связывает|показывает|объясняет|подтверждает|сохраняет|описывает|сравнивает|демонстрирует)/iu.test(withoutTerminal)
    && !hasIncompletePhrase(withoutTerminal);
}
function deterministicContractFunction(index: number, count: number) {
  if (index === 0) return "Промежуточная ориентация вводит grounded тему без дополнительного текста.";
  if (index === count - 1) return "Настоящий финал завершает доступную в речи историю без выдуманного вывода.";
  return [
    "Визуальная пауза акцентирует grounded смысл без добавления нового факта.",
    "Определение раскрывает термин только в границах принятой речи.",
    "Объяснение связи показывает уже подтверждённое отношение материала.",
    "Пример визуализирует пример, прямо названный в принятой речи.",
    "Сравнение сопоставляет только подтверждённые элементы принятой речи.",
    "Промежуточная ориентация сохраняет линию рассказа без нового смысла.",
  ][(index - 1) % 6]!;
}
function isCompleteGroundedSentence(value: string) { return value.length >= 12 && value.length <= 360 && /[.!?]$/u.test(value) && !hasIncompletePhrase(value); }
function fallbackAddedText(index: number) { return `Визуальная пауза сохраняет структуру темы: этап ${index}.`; }
function isAllowedFallbackAddedText(value: string) { return /^Визуальная пауза сохраняет структуру темы: этап \d+\.$/u.test(normalise(value)); }
function normalise(value: string) { return value.replace(/\s+/gu, " ").trim(); }
function safeErrorCode(error: unknown) { return error instanceof Error ? error.name : "unknown"; }
