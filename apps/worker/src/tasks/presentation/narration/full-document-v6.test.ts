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
import { logger } from "../../../observability.js";
import { NARRATION_SYSTEM_PROMPT } from "../constants.js";
import { generateAitunnelFullNarrationOutcome, normalizeV6ProviderTerminationMetadata } from "../providers/generation.js";
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
    expect(aitunnelModelForStage("narration_full_candidate")).toBe("gpt-5.6-luna");
    expect(aitunnelModelForStage("narration_full_rewrite")).toBe("gpt-5.6-terra");
    expect(aitunnelModelForStage("narration_targeted_repair")).toBe("gpt-5.6-luna");
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

    expect(candidateReservation).toMatchObject({ inputTokens: 2941, outputTokens: 4500, costRub: "0.59882000" });
    expect(rewriteReservation).toMatchObject({ inputTokens: 8455, outputTokens: 4500, costRub: "7.09100000" });
    expect(repairReservation).toMatchObject({ inputTokens: 3134, outputTokens: 1400, costRub: "0.23068000" });
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
      compactWorstCaseCostRub: "6.27800000",
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

  it("rewrites a complete candidate rejected for the observed short and template-quality defects", async () => {
    const candidate = fullSpeech([91, 98, 85, 84, 90, 89, 86, 90, 89, 87])
      .replace("fact1_1 fact1_2 fact1_3", "задают логику объяснения");
    const accepted = fullSpeech(Array(10).fill(117));
    const diagnostics = assessFullNarrationDocument(candidate, project, plan);
    const client = { responses: { create: vi.fn()
      .mockResolvedValueOnce({ output_text: candidate, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" })
      .mockResolvedValueOnce({ output_text: accepted, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" }) } };

    expect(diagnostics).toMatchObject({
      totalWords: 889,
      hasCanonicalSectionCoverage: true,
      isStructurallyUsable: false,
      isAccepted: false,
    });
    expect(diagnostics.issueCodes).toEqual(expect.arrayContaining(["template_or_repetition", "whole_speech_below_minimum"]));

    await expect(runV6Narration(client)).resolves.toMatchObject({ kind: "accepted", stage: "narration_full_rewrite", text: accepted });
    expect(client.responses.create).toHaveBeenCalledTimes(2);
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

describe("Prompt 19.6B v6 text-free narration telemetry", () => {
  it("records one safe candidate assessment and accepted-candidate decision", async () => {
    const telemetry = captureV6Telemetry();
    const accepted = fullSpeech(Array(10).fill(117));
    const client = { responses: { create: vi.fn().mockResolvedValue({ output_text: accepted, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" }) } };

    try {
      await expect(runV6Narration(client)).resolves.toMatchObject({ kind: "accepted", stage: "narration_full_candidate" });
      const assessments = telemetry.events.filter((event) => event.telemetryEvent === "narration_v6_attempt_assessment");
      const decision = expectOneRecoveryDecision(telemetry.events, "accepted_candidate");

      expect(assessments).toHaveLength(1);
      expect(assessments[0]).toMatchObject({
        projectId: project.id,
        stage: "drafting_speech",
        narrationStage: "narration_full_candidate",
        narrationTextCall: 1,
        sectionCount: 10,
        totalWords: 1170,
        isStructurallyUsable: true,
        isAccepted: true,
      });
      expect(decision).toMatchObject({
        telemetryEvent: "narration_v6_recovery_decision",
        selectedOutcome: "accepted",
        selectedNarrationStage: "narration_full_candidate",
        attemptStages: ["narration_full_candidate"],
        narrationCallCount: 1,
        maxNarrationCalls: 3,
      });
    } finally {
      telemetry.restore();
    }
  });

  it("records candidate and rewrite assessments before accepted rewrite", async () => {
    const telemetry = captureV6Telemetry();
    const short = fullSpeech(Array(10).fill(110));
    const accepted = fullSpeech(Array(10).fill(117));
    const client = { responses: { create: vi.fn()
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" })
      .mockResolvedValueOnce({ output_text: accepted, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" }) } };

    try {
      await expect(runV6Narration(client)).resolves.toMatchObject({ kind: "accepted", stage: "narration_full_rewrite" });
      expect(telemetry.events.filter((event) => event.telemetryEvent === "narration_v6_attempt_assessment").map((event) => event.narrationStage))
        .toEqual(["narration_full_candidate", "narration_full_rewrite"]);
      expect(expectOneRecoveryDecision(telemetry.events, "accepted_rewrite")).toMatchObject({
        selectedOutcome: "accepted",
        selectedNarrationStage: "narration_full_rewrite",
        narrationCallCount: 2,
      });
    } finally {
      telemetry.restore();
    }
  });

  it("records repair_not_eligible with the selected editable draft and no repair call", async () => {
    const telemetry = captureV6Telemetry();
    const short = fullSpeech(Array(10).fill(110));
    const client = { responses: { create: vi.fn()
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" })
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" }) } };

    try {
      await expect(runV6Narration(client)).resolves.toMatchObject({ kind: "editable_draft", stage: "narration_full_candidate" });
      expect(client.responses.create).toHaveBeenCalledTimes(2);
      expect(expectOneRecoveryDecision(telemetry.events, "repair_not_eligible")).toMatchObject({
        selectedOutcome: "editable_draft",
        selectedNarrationStage: "narration_full_candidate",
        repairEligible: false,
      });
      expect(expectOneRecoveryDecision(telemetry.events, "editable_draft_selected")).toMatchObject({
        selectedOutcome: "editable_draft",
        selectedNarrationStage: "narration_full_candidate",
      });
      expect(telemetry.events.some((event) => event.narrationStage === "narration_targeted_repair")).toBe(false);
    } finally {
      telemetry.restore();
    }
  });

  it("records repair eligibility, the third assessment, and terminal accepted repair without exceeding three calls", async () => {
    const telemetry = captureV6Telemetry();
    const short = fullSpeech([20, ...Array(9).fill(117)]);
    const repairedFirstSection = fullSpeech([117]);
    const client = { responses: { create: vi.fn()
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" })
      .mockResolvedValueOnce({ output_text: short, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" })
      .mockResolvedValueOnce({ output_text: JSON.stringify({ replacements: { "1": repairedFirstSection } }), usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" }) } };

    try {
      await expect(runV6Narration(client)).resolves.toMatchObject({ kind: "accepted", stage: "narration_targeted_repair" });
      expect(client.responses.create).toHaveBeenCalledTimes(3);
      expect(expectOneRecoveryDecision(telemetry.events, "repair_eligible")).toMatchObject({ repairEligible: true, narrationCallCount: 2 });
      expect(telemetry.events.filter((event) => event.telemetryEvent === "narration_v6_attempt_assessment").map((event) => event.narrationStage))
        .toEqual(["narration_full_candidate", "narration_full_rewrite", "narration_targeted_repair"]);
      expect(expectOneRecoveryDecision(telemetry.events, "accepted_repair")).toMatchObject({
        selectedOutcome: "accepted",
        selectedNarrationStage: "narration_targeted_repair",
        narrationCallCount: 3,
      });
    } finally {
      telemetry.restore();
    }
  });

  it("classifies a structurally unusable candidate exactly once without retaining draft text", async () => {
    const telemetry = captureV6Telemetry();
    const unusableDraft = "DRAFT_SENTINEL_NO_USABLE";
    const client = { responses: { create: vi.fn().mockResolvedValue({ output_text: unusableDraft, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" }) } };

    try {
      await expect(runV6Narration(client)).rejects.toThrow("narration_quality_failure");
      expect(client.responses.create).toHaveBeenCalledTimes(1);
      expect(telemetry.events.filter((event) => event.telemetryEvent === "narration_v6_attempt_assessment")).toHaveLength(1);
      expect(expectOneRecoveryDecision(telemetry.events, "candidate_not_usable")).toMatchObject({ selectedOutcome: "none", narrationCallCount: 1 });
      expect(expectOneRecoveryDecision(telemetry.events, "no_usable_draft")).toMatchObject({ selectedOutcome: "none", narrationCallCount: 1 });
      expect(recoveryDecisionEvents(telemetry.events, "terminal_recovery_failure_without_draft")).toHaveLength(0);
      expect(JSON.stringify(telemetry.events)).not.toContain(unusableDraft);
    } finally {
      telemetry.restore();
    }
  });

  it("records a safe provider-failure decision after a usable draft without an extra call or sensitive values", async () => {
    const telemetry = captureV6Telemetry();
    const sentinels = {
      title: "TITLE_SENTINEL_PRIVATE",
      prompt: "PROMPT_SENTINEL_PRIVATE",
      source: "SOURCE_SENTINEL_PRIVATE",
      draft: "DRAFT_SENTINEL_PRIVATE",
      providerError: "RAW_PROVIDER_DETAIL_SENTINEL",
    };
    const sensitiveProject = { ...project, title: sentinels.title, prompt: sentinels.prompt };
    const sensitiveSources = [{ ...sources[0]!, label: sentinels.source }, ...sources.slice(1)];
    const usableDraft = fullSpeech(Array(10).fill(110)).replace("Topic 1", `Topic 1 ${sentinels.draft}`);
    const client = { responses: { create: vi.fn()
      .mockResolvedValueOnce({ output_text: usableDraft, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" })
      .mockRejectedValueOnce(new Error(sentinels.providerError)) } };

    try {
      await expect(runV6Narration(client, sensitiveProject, sensitiveSources)).resolves.toMatchObject({ kind: "editable_draft", stage: "narration_full_candidate" });
      expect(client.responses.create).toHaveBeenCalledTimes(2);
      expect(expectOneRecoveryDecision(telemetry.events, "terminal_provider_or_usage_failure_with_editable_draft")).toMatchObject({
        selectedOutcome: "editable_draft",
        selectedNarrationStage: "narration_full_candidate",
        narrationCallCount: 2,
      });
      expect(expectOneRecoveryDecision(telemetry.events, "editable_draft_selected")).toMatchObject({ selectedOutcome: "editable_draft" });
      const serialized = JSON.stringify(telemetry.events);
      Object.values(sentinels).forEach((sentinel) => expect(serialized).not.toContain(sentinel));
    } finally {
      telemetry.restore();
    }
  });

  it("normalizes known and unknown provider completion metadata without logging raw strings", async () => {
    expect(normalizeV6ProviderTerminationMetadata({
      output_text: "answer",
      usage: {},
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    })).toEqual({
      hasOutputText: true,
      hasUsage: true,
      providerResponseStatus: "incomplete",
      providerTerminationReason: "max_output_tokens",
    });
    expect(normalizeV6ProviderTerminationMetadata({ output_text: "", status: "RAW_STATUS_SENTINEL", incomplete_details: { reason: "RAW_REASON_SENTINEL" } }))
      .toEqual({ hasOutputText: false, hasUsage: false, providerResponseStatus: "unknown", providerTerminationReason: "unknown" });

    const telemetry = captureV6Telemetry();
    const accepted = fullSpeech(Array(10).fill(117));
    const client = { responses: { create: vi.fn().mockResolvedValue({
      output_text: accepted,
      usage: { input_tokens: 1, output_tokens: 1 },
      status: "RAW_STATUS_SENTINEL",
      incomplete_details: { reason: "RAW_REASON_SENTINEL" },
    }) } };

    try {
      await expect(runV6Narration(client)).resolves.toMatchObject({ kind: "accepted" });
      expect(expectOneRecoveryDecision(telemetry.events, "accepted_candidate")).toMatchObject({ narrationCallCount: 1 });
      expect(telemetry.events.find((event) => event.telemetryEvent === "narration_v6_provider_termination")).toMatchObject({
        providerResponseStatus: "unknown",
        providerTerminationReason: "unknown",
        hasOutputText: true,
        hasUsage: true,
      });
      expect(JSON.stringify(telemetry.events)).not.toContain("RAW_STATUS_SENTINEL");
      expect(JSON.stringify(telemetry.events)).not.toContain("RAW_REASON_SENTINEL");
    } finally {
      telemetry.restore();
    }
  });

  it("classifies a first-call provider failure without a usable attempt exactly once", async () => {
    const telemetry = captureV6Telemetry();
    const rawProviderError = "RAW_PROVIDER_FIRST_CALL_SENTINEL";
    const client = { responses: { create: vi.fn().mockRejectedValue(new Error(rawProviderError)) } };

    try {
      await expect(runV6Narration(client)).rejects.toThrow("narration_provider_failure");
      expect(client.responses.create).toHaveBeenCalledTimes(1);
      expect(telemetry.events.filter((event) => event.telemetryEvent === "narration_v6_attempt_assessment")).toHaveLength(0);
      expect(expectOneRecoveryDecision(telemetry.events, "terminal_provider_or_usage_failure_without_draft")).toMatchObject({
        selectedOutcome: "none",
        selectedNarrationStage: null,
        narrationCallCount: 1,
        maxNarrationCalls: 3,
        attemptStages: [],
      });
      expect(expectOneRecoveryDecision(telemetry.events, "no_usable_draft")).toMatchObject({
        selectedOutcome: "none",
        narrationCallCount: 1,
      });
      expect(JSON.stringify(telemetry.events)).not.toContain(rawProviderError);
    } finally {
      telemetry.restore();
    }
  });

  it("continues the existing bounded path when private telemetry logging throws", async () => {
    const accepted = fullSpeech(Array(10).fill(117));
    const client = { responses: { create: vi.fn().mockResolvedValue({ output_text: accepted, usage: { input_tokens: 1, output_tokens: 1 }, status: "completed" }) } };
    const info = vi.spyOn(logger, "info").mockImplementation(() => {
      throw new Error("telemetry sink unavailable");
    });

    try {
      await expect(runV6Narration(client)).resolves.toMatchObject({ kind: "accepted", stage: "narration_full_candidate" });
      expect(client.responses.create).toHaveBeenCalledTimes(1);
    } finally {
      info.mockRestore();
    }
  });
});

function captureV6Telemetry() {
  const events: Array<Record<string, unknown>> = [];
  const info = vi.spyOn(logger, "info").mockImplementation((payload: unknown) => {
    if (payload && typeof payload === "object") events.push(payload as Record<string, unknown>);
    return logger;
  });
  return { events, restore: () => info.mockRestore() };
}

function recoveryDecisionEvents(events: readonly Record<string, unknown>[], decision: string) {
  return events.filter((event) => event.telemetryEvent === "narration_v6_recovery_decision" && event.decision === decision);
}

function expectOneRecoveryDecision(events: readonly Record<string, unknown>[], decision: string) {
  const matching = recoveryDecisionEvents(events, decision);
  expect(matching).toHaveLength(1);
  return matching[0]!;
}

function runV6Narration(client: unknown, narrationProject = project, narrationSources = sources) {
  return runWithAitunnelProjectBudget(
    new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "40", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "40" }),
    () => generateAitunnelFullNarrationOutcome(client as never, narrationProject, narrationSources, plan),
  );
}

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
