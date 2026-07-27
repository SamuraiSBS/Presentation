import { describe, expect, it, vi } from "vitest";
import { standardGenerationCostPolicy, type SlideNarrative, type Source } from "@studydeck/shared";
import {
  AITUNNEL_NARRATION_FULL_CANDIDATE_MAX_OUTPUT_TOKENS,
  AITUNNEL_FULL_NARRATION_MIN_SAFE_OUTPUT_TOKENS,
  AITUNNEL_NARRATION_FULL_REWRITE_MAX_OUTPUT_TOKENS,
  AITUNNEL_NARRATION_TARGETED_REPAIR_MAX_OUTPUT_TOKENS,
  aitunnelModelForStage,
  aitunnelStagePolicy,
  reserveAitunnelStageCall,
  estimateInputTokens,
  AitunnelProjectBudget,
  runWithAitunnelProjectBudget,
} from "../../../aitunnel-narration-budget.js";
import { NARRATION_SYSTEM_PROMPT } from "../constants.js";
import { generateAitunnelFullNarrationOutcome } from "../providers/generation.js";
import {
  buildAitunnelFullNarrationCandidatePrompt,
  buildAitunnelFullNarrationRewriteWithDraftPrompt,
  buildAitunnelTargetedNarrationRepairPrompt,
  aitunnelTargetedNarrationRepairResponseSchema,
} from "../prompts/builders.js";
import {
  assessFullNarrationDocument,
  isFullNarrationTargetedRepairEligible,
  selectBestFullNarrationAttempt,
} from "./processing.js";

const project = {
  id: "full-document-v6",
  title: "Urban transport",
  prompt: "Explain sustainable urban transport for a university report",
  scenario: "report",
  level: "university_student",
  mode: "with_sources",
  slideCount: 10,
};

const plan = Array.from({ length: 10 }, (_, index) => ({
  slideOrder: index + 1,
  slideTitle: `Topic ${index + 1} ${"title ".repeat(30)}`,
  slidePurpose: `Purpose ${index + 1} ${"purpose ".repeat(30)}`,
  keyMessage: `Key message ${index + 1} ${"message ".repeat(30)}`,
  audienceQuestion: "Why does this matter?",
  transitionToNext: "",
  bridgeFromPrevious: "",
  evidenceOrExplanation: `Evidence ${index + 1} ${"evidence ".repeat(30)}`,
  whyItMatters: `Importance ${index + 1} ${"importance ".repeat(30)}`,
})) as SlideNarrative[];

const sources = Array.from({ length: 5 }, (_, index) => ({
  id: `source-${index + 1}`,
  label: `Source ${index + 1} ${"label ".repeat(20)}`,
  type: "TXT",
  size: 0,
  excerpt: index === 4 ? "FIFTH_SOURCE_SENTINEL" : `Evidence ${index + 1} ${"detail ".repeat(40)}`,
  text: "",
  included: true,
})) as Source[];

function fullSpeech(wordsBySlide: readonly number[]) {
  return wordsBySlide.map((count, index) => {
    const order = index + 1;
    const words = Array.from({ length: count }, (_, word) => `fact${order}_${word + 1}`);
    const split = Math.max(1, Math.floor(words.length / 2));
    return `\u0421\u043b\u0430\u0439\u0434 ${order}: Topic ${order}\n${words.slice(0, split).join(" ")}. ${words.slice(split).join(" ")}.`;
  }).join("\n\n");
}

describe("Plan 18 v6 full-document narration foundation", () => {
  it("uses exactly the three future narration stages, models, and output caps", () => {
    expect(aitunnelModelForStage("narration_full_candidate")).toBe("gemini-3.5-flash-lite");
    expect(aitunnelModelForStage("narration_full_rewrite")).toBe("gemini-3.6-flash");
    expect(aitunnelModelForStage("narration_targeted_repair")).toBe("gemini-3.5-flash-lite");
    expect(aitunnelStagePolicy("narration_full_candidate").maxOutputTokens).toBe(AITUNNEL_NARRATION_FULL_CANDIDATE_MAX_OUTPUT_TOKENS);
    expect(aitunnelStagePolicy("narration_full_rewrite").maxOutputTokens).toBe(AITUNNEL_NARRATION_FULL_REWRITE_MAX_OUTPUT_TOKENS);
    expect(aitunnelStagePolicy("narration_targeted_repair").maxOutputTokens).toBe(AITUNNEL_NARRATION_TARGETED_REPAIR_MAX_OUTPUT_TOKENS);
  });

  it("keeps the maximal v6 prompt shapes inside their persisted buckets", () => {
    // These are bounded production fields, not a smaller fixture: 240-char
    // project prompt, 120-char title, ten compact-plan fields and four
    // included sources are all filled to their builder limits.
    const maximumProject = { ...project, title: "я".repeat(120), prompt: "я".repeat(240) };
    const maximumPlan = Array.from({ length: 10 }, (_, index) => ({
      slideOrder: index + 1,
      slideTitle: "я".repeat(25),
      slidePurpose: "я".repeat(35),
      keyMessage: "я".repeat(45),
      audienceQuestion: "",
      transitionToNext: "",
      bridgeFromPrevious: "",
      evidenceOrExplanation: "я".repeat(45),
      whyItMatters: "я".repeat(35),
    })) as SlideNarrative[];
    const maximumSources = Array.from({ length: 4 }, (_, index) => ({
      id: `maximum-source-${index + 1}`,
      label: "я".repeat(40),
      type: "TXT",
      size: 0,
      excerpt: "я".repeat(60),
      text: "",
      included: true,
    })) as Source[];
    const maximumDraft = russianFullSpeech(Array(10).fill(156));
    const maximumDiagnostics = assessFullNarrationDocument(maximumDraft, maximumProject, maximumPlan);
    const candidate = buildAitunnelFullNarrationCandidatePrompt(maximumProject, maximumSources, maximumPlan);
    const rewrite = buildAitunnelFullNarrationRewriteWithDraftPrompt(maximumProject, maximumSources, maximumPlan, maximumDraft, maximumDiagnostics);
    const repairDiagnostics: typeof maximumDiagnostics = { ...maximumDiagnostics, issueCodes: ["fragmentary_section"], affectedSlideOrders: [1, 2, 3], isAccepted: false };
    const repair = buildAitunnelTargetedNarrationRepairPrompt(maximumProject, maximumSources, maximumPlan, maximumDraft, repairDiagnostics);
    const buckets = standardGenerationCostPolicy().buckets;

    const candidateReservation = reserveAitunnelStageCall("narration_full_candidate", productionRequestFor("narration_full_candidate", candidate))!;
    const rewriteReservation = reserveAitunnelStageCall("narration_full_rewrite", productionRequestFor("narration_full_rewrite", rewrite))!;
    const repairReservation = reserveAitunnelStageCall("narration_targeted_repair", productionRequestFor("narration_targeted_repair", repair))!;

    expect(candidateReservation).toMatchObject({ inputTokens: 2944, outputTokens: 4500, costRub: "2.42664000" });
    expect(rewriteReservation).toMatchObject({ inputTokens: 8456, outputTokens: 4500, costRub: "14.08498000" });
    expect(repairReservation).toMatchObject({ inputTokens: 3137, outputTokens: 1400, costRub: "0.88822000" });
    expect(Number(candidateReservation.costRub)).toBeLessThanOrEqual(Number(buckets.narration_full_candidate));
    expect(Number(rewriteReservation.costRub)).toBeLessThanOrEqual(Number(buckets.narration_full_rewrite));
    expect(Number(repairReservation.costRub)).toBeLessThanOrEqual(Number(buckets.narration_targeted_repair));
    expect(repairReservation.outputTokens).toBe(1400);
    expect(repair).toContain("Слайд 1:");
    expect(repair).toContain("Слайд 2:");
    expect(repair).toContain("Слайд 3:");
    expect(repair).not.toContain("Слайд 4:");
  });

  it("accounts for the original Flash overflow without retaining prompt text", () => {
    const candidateDraft = fullSpeech(Array(10).fill(117));
    const diagnostics = assessFullNarrationDocument(candidateDraft, project, plan);
    const original = legacyRewritePrompt(candidateDraft, diagnostics);
    const compact = buildAitunnelFullNarrationRewriteWithDraftPrompt(project, sources, plan, candidateDraft, diagnostics);
    const originalEstimatedInputTokens = estimateInputTokens(requestFor(original));
    const originalReservation = {
      inputTokens: originalEstimatedInputTokens,
      outputTokens: AITUNNEL_NARRATION_FULL_REWRITE_MAX_OUTPUT_TOKENS,
      costRub: ((originalEstimatedInputTokens * 455 + AITUNNEL_NARRATION_FULL_REWRITE_MAX_OUTPUT_TOKENS * 2275) / 1_000_000).toFixed(8),
    };
    const compactReservation = reserveAitunnelStageCall("narration_full_rewrite", requestFor(compact))!;
    const empty = estimateInputTokens(requestFor(""));
    const contribution = (value: string) => estimateInputTokens(requestFor(value)) - empty;
    const originalPlan = JSON.stringify(plan.slice(0, 10).map((item) => ({ slideOrder: item.slideOrder, slideTitle: item.slideTitle.slice(0, 25), slidePurpose: item.slidePurpose.slice(0, 35), keyMessage: item.keyMessage.slice(0, 45), evidenceOrExplanation: (item.evidenceOrExplanation || "").slice(0, 45), whyItMatters: (item.whyItMatters || "").slice(0, 35) })));
    const originalSources = JSON.stringify(sources.filter((source) => source.included !== false).slice(0, 4).map((source) => ({ title: source.label.slice(0, 40), evidence: source.excerpt.slice(0, 80) })));
    const originalDiagnostics = JSON.stringify({ totalWords: diagnostics.totalWords, sectionWordCounts: diagnostics.sectionWordCounts, issueCodes: diagnostics.issueCodes, affectedSlideOrders: diagnostics.affectedSlideOrders });
    const originalInstructions = [
      "Rewrite the complete Russian university speech below. Return a fresh complete speech, not commentary about the rewrite.",
      "Exact slide count: 10. Return all ten sections in order, each headed `Слайд N: semantic title`.",
      "Hard whole-speech contract: 1170-1560 words; target 1300. Soft opening/content/conclusion guidance: 80/140/100.",
      "Preserve strong supported content where useful, expand thin reasoning, remove repetition, and redistribute detail across the whole argument. Do not expose validation language, source labels, or provider commentary to the user.",
      "Cautious general educational explanation is permitted when sources lack precise anchors. Do not invent precise names, dates, statistics, quotations, or citations.",
    ].join("\n\n");

    expect({
      estimatedInputTokens: originalReservation.inputTokens,
      maxOutputTokens: originalReservation.outputTokens,
      worstCaseCostRub: originalReservation.costRub,
      bucketRub: "13.50000000",
      excessRub: (Number(originalReservation.costRub) - 13.5).toFixed(8),
      draftTokens: contribution(`Previous complete draft to rewrite:\n${candidateDraft}`),
      planTokens: contribution(`Fixed compact narrative plan:\n${originalPlan}`),
      sourceTokens: contribution(`Bounded factual source snapshot (internal grounding only; never cite it):\n${originalSources}`),
      diagnosticsTokens: contribution(`Private local diagnostics for this rewrite only:\n${originalDiagnostics}`),
      systemInstructionsTokens: contribution(NARRATION_SYSTEM_PROMPT),
      instructionsTokens: contribution(originalInstructions),
      compactEstimatedInputTokens: compactReservation.inputTokens,
      compactWorstCaseCostRub: compactReservation.costRub,
    }).toEqual({
      estimatedInputTokens: 10376,
      maxOutputTokens: 4500,
      worstCaseCostRub: "14.95858000",
      bucketRub: "13.50000000",
      excessRub: "1.45858000",
      draftTokens: 6355,
      planTokens: 1854,
      sourceTokens: 400,
      diagnosticsTokens: 104,
      systemInstructionsTokens: 1192,
      instructionsTokens: 422,
      compactEstimatedInputTokens: 4390,
      compactWorstCaseCostRub: "12.23495000",
    });
  });

  it("retains a safe 4,500-token full-output cap for 1,560 Russian words and framing", () => {
    expect(AITUNNEL_FULL_NARRATION_MIN_SAFE_OUTPUT_TOKENS).toBe(4483);
    expect(AITUNNEL_NARRATION_FULL_CANDIDATE_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(AITUNNEL_FULL_NARRATION_MIN_SAFE_OUTPUT_TOKENS);
    expect(AITUNNEL_NARRATION_FULL_REWRITE_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(AITUNNEL_FULL_NARRATION_MIN_SAFE_OUTPUT_TOKENS);
  });

  it("builds safe candidate/rewrite/repair prompt content without a per-slide sentence floor", () => {
    const acceptedDraft = fullSpeech(Array(10).fill(117));
    const diagnostics = assessFullNarrationDocument(acceptedDraft, project, plan);
    const candidate = buildAitunnelFullNarrationCandidatePrompt(project, sources, plan);
    const rewrite = buildAitunnelFullNarrationRewriteWithDraftPrompt(project, sources, plan, acceptedDraft, diagnostics);
    const repair = buildAitunnelTargetedNarrationRepairPrompt(project, sources, plan, fullSpeech([140, 20, 140, 140, 140, 140, 140, 140, 140, 140]), assessFullNarrationDocument(fullSpeech([140, 20, 140, 140, 140, 140, 140, 140, 140, 140]), project, plan));

    expect(candidate).toContain("Fixed compact narrative plan");
    expect(candidate).toContain("cautious general educational explanation");
    expect(candidate).toContain("1170-1560 words");
    expect(candidate).not.toContain("2-7 complete sentences");
    expect(candidate).not.toContain("FIFTH_SOURCE_SENTINEL");
    expect(rewrite).toContain(acceptedDraft);
    expect(rewrite).toContain("sectionWords");
    expect(repair).toContain("Requested slide orders: 2");
    expect(repair).toContain("Слайд 2");
    expect(repair).not.toContain("Слайд 1");
    expect(repair).not.toContain("FIFTH_SOURCE_SENTINEL");
    expect(repair).toContain("\"replacements\"");
    expect(aitunnelTargetedNarrationRepairResponseSchema.safeParse({ replacements: { "2": "\u0421\u043b\u0430\u0439\u0434 2: Topic\nComplete replacement prose." } }).success).toBe(true);
    expect(aitunnelTargetedNarrationRepairResponseSchema.safeParse({ replacements: { "11": "out of range" } }).success).toBe(false);
  });

  it("accepts only the full 10-section 1170-1560-word contract and retains safe salvage diagnostics", () => {
    const accepted = assessFullNarrationDocument(fullSpeech(Array(10).fill(117)), project, plan);
    const short = assessFullNarrationDocument(fullSpeech(Array(10).fill(110)), project, plan);
    const localDefect = assessFullNarrationDocument(fullSpeech([140, 20, 140, 140, 140, 140, 140, 140, 140, 140]), project, plan);

    expect(accepted).toMatchObject({ isAccepted: true, isStructurallyUsable: true, totalWords: 1170, issueCodes: [] });
    expect(short).toMatchObject({ isAccepted: false, isStructurallyUsable: true, totalWords: 1100 });
    expect(short.issueCodes).toContain("whole_speech_below_minimum");
    expect(isFullNarrationTargetedRepairEligible(short)).toBe(false);
    expect(localDefect.issueCodes).toEqual(["fragmentary_section"]);
    expect(isFullNarrationTargetedRepairEligible(localDefect)).toBe(true);
  });

  it("selects accepted output first and otherwise ranks editable drafts deterministically", () => {
    const acceptedText = fullSpeech(Array(10).fill(117));
    const accepted = assessFullNarrationDocument(acceptedText, project, plan);
    const candidateText = fullSpeech(Array(10).fill(116));
    const rewriteText = fullSpeech(Array(10).fill(110));
    const candidate = assessFullNarrationDocument(candidateText, project, plan);
    const rewrite = assessFullNarrationDocument(rewriteText, project, plan);

    expect(selectBestFullNarrationAttempt([
      { stage: "narration_full_candidate", text: candidateText, diagnostics: candidate },
      { stage: "narration_full_rewrite", text: rewriteText, diagnostics: rewrite },
    ])).toEqual({ kind: "editable_draft", text: candidateText, stage: "narration_full_candidate" });
    expect(selectBestFullNarrationAttempt([
      { stage: "narration_full_candidate", text: candidateText, diagnostics: candidate },
      { stage: "narration_full_rewrite", text: acceptedText, diagnostics: accepted },
    ])).toEqual({ kind: "accepted", text: acceptedText, stage: "narration_full_rewrite" });
  });

  it("runs at most the bounded candidate, rewrite, and batch-repair sequence", async () => {
    const valid = fullSpeech(Array(10).fill(117));
    const short = fullSpeech([20, ...Array(9).fill(117)]);
    const repairedFirstSection = fullSpeech([117]);

    const candidateClient = { responses: { create: vi.fn().mockResolvedValue({ output_text: valid, usage: { input_tokens: 1, output_tokens: 1 } }) } };
    await expect(runWithAitunnelProjectBudget(
      new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "40", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "40" }),
      () => generateAitunnelFullNarrationOutcome(candidateClient as never, project, sources, plan),
    )).resolves.toMatchObject({ kind: "accepted", stage: "narration_full_candidate", text: valid });
    expect(candidateClient.responses.create).toHaveBeenCalledTimes(1);

    const rewriteClient = { responses: { create: vi.fn()
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ output_text: valid, usage: { input_tokens: 1, output_tokens: 1 } }) } };
    await expect(runWithAitunnelProjectBudget(
      new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "40", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "40" }),
      () => generateAitunnelFullNarrationOutcome(rewriteClient as never, project, sources, plan),
    )).resolves.toMatchObject({ kind: "accepted", stage: "narration_full_rewrite", text: valid });
    expect(rewriteClient.responses.create).toHaveBeenCalledTimes(2);

    const repairClient = { responses: { create: vi.fn()
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ output_text: JSON.stringify({ replacements: { "1": repairedFirstSection } }), usage: { input_tokens: 1, output_tokens: 1 } }) } };
    await expect(runWithAitunnelProjectBudget(
      new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "40", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "40" }),
      () => generateAitunnelFullNarrationOutcome(repairClient as never, project, sources, plan),
    )).resolves.toMatchObject({ kind: "accepted", stage: "narration_targeted_repair" });
    expect(repairClient.responses.create).toHaveBeenCalledTimes(3);
  });

  it("returns the best editable draft after exhausted recovery or a later provider failure", async () => {
    const short = fullSpeech([20, ...Array(9).fill(117)]);
    const stillShortRepair = fullSpeech([20]);
    const exhaustedClient = { responses: { create: vi.fn()
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ output_text: JSON.stringify({ replacements: { "1": stillShortRepair } }), usage: { input_tokens: 1, output_tokens: 1 } }) } };
    await expect(runWithAitunnelProjectBudget(
      new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "40", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "40" }),
      () => generateAitunnelFullNarrationOutcome(exhaustedClient as never, project, sources, plan),
    )).resolves.toMatchObject({ kind: "editable_draft", stage: "narration_full_candidate", text: short });
    expect(exhaustedClient.responses.create).toHaveBeenCalledTimes(3);

    const failedRewriteClient = { responses: { create: vi.fn()
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 } })
      .mockRejectedValueOnce(new Error("provider unavailable")) } };
    await expect(runWithAitunnelProjectBudget(
      new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "40", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "40" }),
      () => generateAitunnelFullNarrationOutcome(failedRewriteClient as never, project, sources, plan),
    )).resolves.toMatchObject({ kind: "editable_draft", stage: "narration_full_candidate", text: short });
    expect(failedRewriteClient.responses.create).toHaveBeenCalledTimes(2);
  });
});

function requestFor(prompt: string) {
  return { input: [{ role: "system", content: NARRATION_SYSTEM_PROMPT }, { role: "user", content: prompt }] };
}

function productionRequestFor(stage: "narration_full_candidate" | "narration_full_rewrite" | "narration_targeted_repair", prompt: string) {
  const policy = aitunnelStagePolicy(stage);
  return {
    model: policy.model,
    input: [{ role: "system" as const, content: NARRATION_SYSTEM_PROMPT }, { role: "user" as const, content: prompt }],
    max_output_tokens: policy.maxOutputTokens,
    reasoning: { effort: policy.reasoningEffort, exclude: true },
    ...(stage === "narration_targeted_repair" ? { text: { format: { type: "json_object" as const } } } : {}),
  };
}

function russianFullSpeech(wordsBySlide: readonly number[]) {
  return wordsBySlide.map((count, index) => {
    const order = index + 1;
    const words = Array.from({ length: count }, (_, word) => `слово${order}_${word + 1}`);
    return `Слайд ${order}: Раздел ${order}\n${words.join(" ")}.`;
  }).join("\n\n");
}

function legacyRewritePrompt(previousDraft: string, diagnostics: ReturnType<typeof assessFullNarrationDocument>) {
  const originalPlan = plan.slice(0, 10).map((item) => ({
    slideOrder: item.slideOrder,
    slideTitle: item.slideTitle.slice(0, 25),
    slidePurpose: item.slidePurpose.slice(0, 35),
    keyMessage: item.keyMessage.slice(0, 45),
    evidenceOrExplanation: (item.evidenceOrExplanation || "").slice(0, 45),
    whyItMatters: (item.whyItMatters || "").slice(0, 35),
  }));
  const originalSources = sources.filter((source) => source.included !== false).slice(0, 4).map((source) => ({ title: source.label.slice(0, 40), evidence: source.excerpt.slice(0, 80) }));
  return [
    "Rewrite the complete Russian university speech below. Return a fresh complete speech, not commentary about the rewrite.",
    "Exact slide count: 10. Return all ten sections in order, each headed `Слайд N: semantic title`.",
    "Hard whole-speech contract: 1170-1560 words; target 1300. Soft opening/content/conclusion guidance: 80/140/100.",
    "Preserve strong supported content where useful, expand thin reasoning, remove repetition, and redistribute detail across the whole argument. Do not expose validation language, source labels, or provider commentary to the user.",
    "Cautious general educational explanation is permitted when sources lack precise anchors. Do not invent precise names, dates, statistics, quotations, or citations.",
    `Private local diagnostics for this rewrite only:\n${JSON.stringify({ totalWords: diagnostics.totalWords, sectionWordCounts: diagnostics.sectionWordCounts, issueCodes: diagnostics.issueCodes, affectedSlideOrders: diagnostics.affectedSlideOrders })}`,
    `Fixed compact narrative plan:\n${JSON.stringify(originalPlan)}`,
    `Bounded factual source snapshot (internal grounding only; never cite it):\n${JSON.stringify(originalSources)}`,
    `Previous complete draft to rewrite:\n${previousDraft}`,
  ].join("\n\n");
}
