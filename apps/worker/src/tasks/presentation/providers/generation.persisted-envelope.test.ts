import { COST_ENVELOPE_POLICY_VERSION, historicalStandardGenerationCostPolicyV5, standardGenerationCostPolicy, type Source } from "@studydeck/shared";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  reserveCostEnvelope: vi.fn(),
  reserveCostEnvelopeBatch: vi.fn(),
  releaseCostEnvelope: vi.fn(),
  settleCostEnvelope: vi.fn(),
  aiUsageEventUpsert: vi.fn(),
}));

vi.mock("../../../prisma.js", () => ({
  getPrisma: () => ({
    costEnvelope: { findUniqueOrThrow: mocks.findUniqueOrThrow },
    aiUsageEvent: { upsert: mocks.aiUsageEventUpsert },
  }),
}));

vi.mock("../../../cost-envelope.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../cost-envelope.js")>()),
  reserveCostEnvelope: mocks.reserveCostEnvelope,
  reserveCostEnvelopeBatch: mocks.reserveCostEnvelopeBatch,
  releaseCostEnvelope: mocks.releaseCostEnvelope,
  settleCostEnvelope: mocks.settleCostEnvelope,
}));

import { getFloorAwareSpeechTimingSectionBounds, getRussianStudentSpeechTimingBudget } from "@studydeck/shared";
import { AitunnelProjectBudget, reserveAitunnelStageCall, runWithAitunnelProjectBudget, type AitunnelNarrationSectionStage } from "../../../aitunnel-narration-budget.js";
import { logger } from "../../../observability.js";
import { runWithUsageContext } from "../../../usage-ledger.js";
import { AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT, NARRATION_SYSTEM_PROMPT } from "../constants.js";
import { assessFullNarrationDocument } from "../narration/processing.js";
import { buildAitunnelFullNarrationRewriteWithDraftPrompt, buildAitunnelNarrationGlobalRewritePrompt, buildAitunnelNarrationSectionPrompt, buildAitunnelNarrationSectionReplacementPrompt } from "../prompts/builders.js";
import { generateAitunnelNarration, generateNarrativePlanWithProvider, MAX_AITUNNEL_NARRATION_TEXT_CALLS } from "./generation.js";

const project = {
  id: "persisted-envelope-project",
  title: "Budget telemetry",
  prompt: "PERSISTED_ENVELOPE_PROMPT_SENTINEL_DO_NOT_LOG",
  scenario: "report",
  level: "university_student",
  mode: "create",
  slideCount: 10,
};

const plan = Array.from({ length: 10 }, (_, index) => ({
  slideOrder: index + 1,
  slideTitle: `Раздел ${index + 1} ${"содержательный заголовок ".repeat(80)}`,
  slidePurpose: `Объяснить аспект ${index + 1}`,
  keyMessage: `Ключевая мысль ${index + 1} ${"проверяемое содержание ".repeat(180)}`,
  audienceQuestion: `Почему аспект ${index + 1} важен?`,
  transitionToNext: "",
  evidenceOrExplanation: `Факт ${index + 1}`,
  whyItMatters: `Значение ${index + 1}`,
}));

const groundedSources = [
  {
    id: "source-1",
    label: "Университетский архив с длинным описательным названием источника ".repeat(4),
    excerpt: "Фактический контекст для академического объяснения ".repeat(80),
    included: true,
  },
  {
    id: "source-2",
    label: "Научная статья с дополнительным контекстом ".repeat(4),
    excerpt: "Дополнительная проверяемая деталь ".repeat(80),
    included: true,
  },
] as Source[];

afterEach(() => {
  mocks.findUniqueOrThrow.mockReset();
  mocks.reserveCostEnvelope.mockReset();
  mocks.reserveCostEnvelopeBatch.mockReset();
  mocks.releaseCostEnvelope.mockReset();
  mocks.settleCostEnvelope.mockReset();
  mocks.aiUsageEventUpsert.mockReset();
});

it("logs a safe persisted-envelope reason when a narration bucket is missing", async () => {
  const logged: unknown[] = [];
  const info = vi.spyOn(logger, "info").mockImplementation((payload: unknown) => {
    logged.push(payload);
    return logger;
  });
  const create = vi.fn();
  const client = { responses: { create } } as never;
  mocks.findUniqueOrThrow.mockResolvedValue({ policySnapshot: { buckets: {} } });

  try {
    await expect(runWithUsageContext(
      { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
      () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
    )).rejects.toThrow("narration_budget_exhausted_failure");

    expect(create).not.toHaveBeenCalled();
    expect(mocks.reserveCostEnvelopeBatch).not.toHaveBeenCalled();
    expect(logged).toContainEqual(expect.objectContaining({
      projectId: project.id,
      narrationStage: "narration_section_1_candidate",
      failureCategory: "narration_budget_exhausted",
      preflightReason: "missing_policy_bucket",
    }));
    expect(JSON.stringify(logged)).not.toContain(project.prompt);
  } finally {
    info.mockRestore();
  }
});

it("accepts the bounded maximal v6 reservation batch before its first provider call", async () => {
  const create = vi.fn().mockResolvedValue({ output_text: fullV6Speech(), usage: { input_tokens: 1, output_tokens: 1 } });
  const client = { responses: { create } } as never;
  mocks.findUniqueOrThrow.mockResolvedValue({ policySnapshot: standardGenerationCostPolicy() });
  mocks.reserveCostEnvelopeBatch.mockResolvedValue({ status: "reserved" });
  mocks.settleCostEnvelope.mockResolvedValue({ status: "settled" });
  mocks.aiUsageEventUpsert.mockResolvedValue({});

  await expect(runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1", costEnvelopePolicyVersion: COST_ENVELOPE_POLICY_VERSION },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "40", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "40" }), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, groundedSources, plan)),
  )).resolves.toBeTruthy();

  expect(create).toHaveBeenCalled();
  const [inputs] = mocks.reserveCostEnvelopeBatch.mock.calls[0]!;
  expect(inputs.map((input: { stage: string }) => input.stage)).toEqual(["narration_full_candidate", "narration_full_rewrite", "narration_targeted_repair"]);
});

it("measures the persisted maximum Luna rewrite payload without emitting its text", () => {
  const draft = fullV6Speech(156);
  const prompt = buildAitunnelFullNarrationRewriteWithDraftPrompt(project, groundedSources, plan, draft, assessFullNarrationDocument(draft, project, plan));
  expect(reserveAitunnelStageCall("narration_full_rewrite", { input: [{ role: "system", content: NARRATION_SYSTEM_PROMPT }, { role: "user", content: prompt }] })!).toMatchObject({ inputTokens: 8406, outputTokens: 4500, costRub: "0.70812000" });
});

it("still fail-closes v6 before a provider call when a maximum rewrite no longer fits its bucket", async () => {
  const create = vi.fn();
  const client = { responses: { create } } as never;
  const policy = standardGenerationCostPolicy();
  policy.buckets.narration_full_rewrite = "0.70811999";
  mocks.findUniqueOrThrow.mockResolvedValue({ policySnapshot: policy });
  mocks.reserveCostEnvelopeBatch.mockResolvedValue({ status: "blocked", reason: "policy_bucket_exceeded" });

  await expect(runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1", costEnvelopePolicyVersion: COST_ENVELOPE_POLICY_VERSION },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget({ AITUNNEL_PROJECT_BUDGET_RUB: "40", AITUNNEL_NARRATION_JOB_BUDGET_RUB: "40" }), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, groundedSources, plan)),
  )).rejects.toThrow("narration_budget_exhausted_failure");

  expect(create).not.toHaveBeenCalled();
  expect(mocks.reserveCostEnvelopeBatch).toHaveBeenCalledTimes(1);
});

it("keeps every grounded runtime section prompt within its persisted candidate and fallback buckets", () => {
  const policy = historicalStandardGenerationCostPolicyV5();

  for (const slideOrder of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const) {
    const narrative = plan[slideOrder - 1]!;
    const candidateStage: AitunnelNarrationSectionStage = `narration_section_${slideOrder}_candidate`;
    const fallbackStage: AitunnelNarrationSectionStage = `narration_section_${slideOrder}_fallback`;
    const candidate = buildAitunnelNarrationSectionPrompt(project, groundedSources, narrative);
    const fallback = buildAitunnelNarrationSectionReplacementPrompt(project, groundedSources, narrative, "narration_quality");
    const global = buildAitunnelNarrationGlobalRewritePrompt(project, groundedSources, narrative, "narration_quality");
    const bounds = getFloorAwareSpeechTimingSectionBounds(getRussianStudentSpeechTimingBudget(project)!, slideOrder)!;

    for (const prompt of [candidate, fallback, global]) {
      expect(prompt).toContain(`${bounds.minWords}-${bounds.maxWords}`);
      expect(prompt).toContain(`${bounds.targetWords}`);
    }

    expect(Number(reserveAitunnelStageCall(candidateStage, { input: [{ role: "system", content: AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT }, { role: "user", content: candidate }] })!.costRub))
      .toBeLessThanOrEqual(Number(policy.buckets[candidateStage as keyof typeof policy.buckets]));
    expect(Number(reserveAitunnelStageCall(fallbackStage, { input: [{ role: "system", content: AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT }, { role: "user", content: fallback }] })!.costRub))
      .toBeLessThanOrEqual(Number(policy.buckets[fallbackStage as keyof typeof policy.buckets]));
    expect(Number(reserveAitunnelStageCall("narration_global_rewrite", { input: [{ role: "system", content: AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT }, { role: "user", content: global }] })!.costRub))
      .toBeLessThanOrEqual(Number(policy.buckets.narration_global_rewrite));
  }
});

it("submits twenty unique narration reservations to one persisted envelope before provider calls", async () => {
  const policy = historicalStandardGenerationCostPolicyV5();
  const create = vi.fn();
  const client = { responses: { create } } as never;
  mocks.findUniqueOrThrow.mockResolvedValue({ policySnapshot: policy });
  mocks.reserveCostEnvelopeBatch.mockResolvedValue({ status: "blocked", reason: "envelope_exhausted" });

  await expect(runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
  )).rejects.toThrow("narration_budget_exhausted_failure");

  const [inputs] = mocks.reserveCostEnvelopeBatch.mock.calls[0]!;
  expect(inputs).toHaveLength(21);
  expect(new Set(inputs.map((input: { idempotencyKey: string }) => input.idempotencyKey)).size).toBe(21);
  expect(new Set(inputs.map((input: { envelopeId: string }) => input.envelopeId))).toEqual(new Set(["envelope-1"]));
  expect(inputs.map((input: { bucket: string }) => input.bucket)).toEqual(expect.arrayContaining([
    "narration_section_1_candidate",
    "narration_section_1_fallback",
    "narration_section_10_candidate",
    "narration_section_10_fallback",
    "narration_global_rewrite",
  ]));
  expect(create).not.toHaveBeenCalled();
});

it("settles one persisted narrative-plan reservation with the matching envelope-scoped AI usage", async () => {
  const policy = historicalStandardGenerationCostPolicyV5();
  const create = vi.fn().mockResolvedValue({
    output_parsed: plan,
    usage: { input_tokens: 100, output_tokens: 100 },
    id: "narrative-plan-response",
  });
  const client = { responses: { create } } as never;
  mocks.findUniqueOrThrow.mockResolvedValue({ policySnapshot: policy });
  mocks.reserveCostEnvelope.mockResolvedValue({ status: "reserved" });
  mocks.settleCostEnvelope.mockResolvedValue({ status: "settled" });
  mocks.aiUsageEventUpsert.mockResolvedValue({});

  await runWithUsageContext(
    { userId: "user-1", projectId: project.id, generationJobId: "job-1", costEnvelopeId: "envelope-1" },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateNarrativePlanWithProvider(
      "aitunnel",
      project,
      [],
      {} as never,
      { openAIClient: client, openAIModel: "gemini-3.6-flash" },
    )),
  );

  expect(create).toHaveBeenCalledTimes(1);
  expect(mocks.reserveCostEnvelope).toHaveBeenCalledWith(expect.objectContaining({
    envelopeId: "envelope-1",
    idempotencyKey: "envelope-1:job-1:narrative_plan",
    bucket: "narrative_plan",
    stage: "narrative_plan",
    amountRub: policy.buckets.narrative_plan,
  }));
  expect(mocks.settleCostEnvelope).toHaveBeenCalledWith(expect.objectContaining({
    envelopeId: "envelope-1",
    idempotencyKey: "envelope-1:job-1:narrative_plan",
    actualRub: expect.any(String),
  }));
  expect(mocks.aiUsageEventUpsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ costEnvelopeId: "envelope-1", stage: "narrative_plan" }),
  }));
});

it("reconciles narration AI, narrative-plan AI, and the separate source-search CostEvent", () => {
  const narrationAiRub = "4.09326000";
  const narrativePlanAiRub = "0.65246000";
  const sourceSearchCostEventRub = "0.50000000";
  const aiUsageTotal = addRub(narrationAiRub, narrativePlanAiRub);

  expect(aiUsageTotal).toBe("4.74572000");
  expect(addRub(aiUsageTotal, sourceSearchCostEventRub)).toBe("5.24572000");
  expect(sourceSearchCostEventRub).toBe("0.50000000");
});

it("serially releases every unused reservation after a section quality terminal failure", async () => {
  const policy = historicalStandardGenerationCostPolicyV5();
  const statuses = new Map<string, "reserved" | "settled" | "released">();
  const releaseOrder: string[] = [];
  const logged: unknown[] = [];
  const info = vi.spyOn(logger, "info").mockImplementation((payload: unknown) => {
    logged.push(payload);
    return logger;
  });
  const acceptedText = `1. Verified section\n${Array.from({ length: 36 }, (_, index) => `evidence${index + 1}`).join(" ")}. ${Array.from({ length: 36 }, (_, index) => `context${index + 1}`).join(" ")}.`;
  const invalidText = "2. Incomplete section\nToo short.";
  const create = vi.fn()
    .mockResolvedValueOnce({ output_text: acceptedText, usage: { input_tokens: 1, output_tokens: 1 } })
    .mockResolvedValueOnce({ output_text: invalidText, usage: { input_tokens: 1, output_tokens: 1 } })
    .mockResolvedValueOnce({ output_text: invalidText, usage: { input_tokens: 1, output_tokens: 1 } })
    .mockResolvedValueOnce({ output_text: invalidText, usage: { input_tokens: 1, output_tokens: 1 } });
  const client = { responses: { create } } as never;
  mocks.findUniqueOrThrow.mockResolvedValue({ policySnapshot: policy });
  mocks.reserveCostEnvelopeBatch.mockImplementation(async (inputs: Array<{ idempotencyKey: string }>) => {
    for (const input of inputs) statuses.set(input.idempotencyKey, "reserved");
    return { status: "reserved" };
  });
  mocks.settleCostEnvelope.mockImplementation(async ({ idempotencyKey }: { idempotencyKey: string }) => {
    statuses.set(idempotencyKey, "settled");
    return { status: "settled" };
  });
  mocks.releaseCostEnvelope.mockImplementation(async ({ idempotencyKey, reason }: { idempotencyKey: string; reason: string }) => {
    releaseOrder.push(idempotencyKey);
    if (statuses.get(idempotencyKey) === "reserved") statuses.set(idempotencyKey, "released");
    return { status: statuses.get(idempotencyKey), reason };
  });

  try {
    await expect(runWithUsageContext(
      { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
      () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
    )).rejects.toThrow("narration_quality_failure");

    const stageKey = (stage: string) => `envelope-1:${stage}`;
    const laterStages = Array.from({ length: 8 }, (_, index) => index + 3).flatMap((slideOrder) => [
      `narration_section_${slideOrder}_candidate`,
      `narration_section_${slideOrder}_fallback`,
    ]);
    expect(create).toHaveBeenCalledTimes(4);
    expect(statuses.get(stageKey("narration_section_1_candidate"))).toBe("settled");
    expect(statuses.get(stageKey("narration_section_1_fallback"))).toBe("released");
    expect(statuses.get(stageKey("narration_section_2_candidate"))).toBe("settled");
    expect(statuses.get(stageKey("narration_section_2_fallback"))).toBe("settled");
    expect(logged).toContainEqual(expect.objectContaining({
      narrationStage: "narration_section_2_candidate", model: "gpt-5.6-luna", failureCategory: "quality", qualityReason: "word_range",
    }));
    expect(logged).toContainEqual(expect.objectContaining({
      narrationStage: "narration_section_2_fallback", model: "gpt-5.6-luna", failureCategory: "quality", qualityReason: "word_range",
    }));
    expect(JSON.stringify(logged)).not.toContain(invalidText);
    for (const stage of laterStages) {
      expect(statuses.get(stageKey(stage))).toBe("released");
      expect(releaseOrder.filter((key) => key === stageKey(stage))).toHaveLength(1);
    }
    expect(releaseOrder).toEqual([
      stageKey("narration_section_1_fallback"),
      ...Array.from({ length: 10 }, (_, index) => index + 1).flatMap((slideOrder) => [
        stageKey(`narration_section_${slideOrder}_candidate`),
        stageKey(`narration_section_${slideOrder}_fallback`),
      ]),
      stageKey("narration_global_rewrite"),
    ]);
  } finally {
    info.mockRestore();
  }
});

it("logs no quality reason and makes no fallback call when every Lite section is accepted", async () => {
  const logged: unknown[] = [];
  const info = vi.spyOn(logger, "info").mockImplementation((payload: unknown) => {
    logged.push(payload);
    return logger;
  });
  const create = vi.fn().mockImplementation(async (_request) => {
    const call = create.mock.calls.length;
    const words = call === 1 ? 60 : call === 10 ? 80 : 70;
    const firstSentenceWords = Math.floor(words / 2);
    return { output_text: `${call}. Verified section\n${Array.from({ length: firstSentenceWords }, (_, index) => `topic${call}_${index}`).join(" ")}. ${Array.from({ length: words - firstSentenceWords }, (_, index) => `detail${call}_${index}`).join(" ")}.`, usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  try {
    await runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan));

    expect(create).toHaveBeenCalledTimes(10);
    expect(create.mock.calls.every(([request]) => request.model === "gpt-5.6-luna")).toBe(true);
    expect(logged.filter((entry) => (entry as { failureCategory?: string }).failureCategory === "quality")).toHaveLength(0);
    expect(logged.every((entry) => (entry as { narrationStage?: string }).narrationStage?.endsWith("_candidate"))).toBe(true);
    expect(new Set(logged.map((entry) => (entry as { narrationStage: string }).narrationStage)).size).toBe(10);
  } finally {
    info.mockRestore();
  }
});

it("rejects an overlong section locally and uses only the existing fallback/global path", async () => {
  const statuses = setPersistedReservationMocks();
  const create = vi.fn().mockImplementation(async () => {
    const call = create.mock.calls.length;
    const order = call === 1 ? 1 : call === 2 || call === 3 || call === 4 ? 2 : call - 2;
    const words = order === 1 ? 60 : order === 2 && call < 4 ? 40 : order === 2 ? 70 : order === 10 ? 80 : 70;
    return { output_text: sectionText(order, words), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  await runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
  );

  expect(create).toHaveBeenCalledTimes(12);
  expect(create.mock.calls.slice(0, 4).map(([request]) => request.model)).toEqual(Array(4).fill("gpt-5.6-luna"));
  expect(statuses.get("envelope-1:narration_section_2_fallback")).toBe("settled");
  expect(statuses.get("envelope-1:narration_global_rewrite")).toBe("settled");
  expect(MAX_AITUNNEL_NARRATION_TEXT_CALLS).toBe(3);
});

function sectionText(order: number, words: number) {
  const firstSentenceWords = Math.floor(words / 2);
  return `${order}. Verified section\n${Array.from({ length: firstSentenceWords }, (_, index) => `topic${order}_${index}`).join(" ")}. ${Array.from({ length: words - firstSentenceWords }, (_, index) => `detail${order}_${index}`).join(" ")}.`;
}

function addRub(left: string, right: string) {
  const toUnits = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100_000_000n + BigInt(`${fraction}00000000`.slice(0, 8));
  };
  const units = toUnits(left) + toUnits(right);
  return `${units / 100_000_000n}.${(units % 100_000_000n).toString().padStart(8, "0")}`;
}

function fullV6Speech(wordsPerSection = 70) {
  return Array.from({ length: 10 }, (_, index) => {
    const words = Array.from({ length: wordsPerSection }, (_unused, word) => `слово${index + 1}_${word + 1}`).join(" ");
    return `Слайд ${index + 1}: Раздел ${index + 1}\n${words}.`;
  }).join("\n\n");
}

function setPersistedReservationMocks(policy = historicalStandardGenerationCostPolicyV5()) {
  const statuses = new Map<string, "reserved" | "settled" | "released">();
  mocks.findUniqueOrThrow.mockResolvedValue({ policySnapshot: policy });
  mocks.reserveCostEnvelopeBatch.mockImplementation(async (inputs: Array<{ idempotencyKey: string }>) => {
    for (const input of inputs) statuses.set(input.idempotencyKey, "reserved");
    return { status: "reserved" };
  });
  mocks.settleCostEnvelope.mockImplementation(async ({ idempotencyKey }: { idempotencyKey: string }) => {
    statuses.set(idempotencyKey, "settled");
    return { status: "settled" };
  });
  mocks.releaseCostEnvelope.mockImplementation(async ({ idempotencyKey }: { idempotencyKey: string }) => {
    if (statuses.get(idempotencyKey) === "reserved") statuses.set(idempotencyKey, "released");
    return { status: statuses.get(idempotencyKey) };
  });
  return statuses;
}

it("uses a normal per-slide Flash fallback and releases the one global slot when it is not needed", async () => {
  const statuses = setPersistedReservationMocks();
  const create = vi.fn().mockImplementation(async () => {
    const call = create.mock.calls.length;
    if (call === 1) return { output_text: "1. Too short\nNo.", usage: { input_tokens: 1, output_tokens: 1 } };
    const order = call === 2 ? 1 : call - 1;
    return { output_text: sectionText(order, order === 1 ? 60 : order === 10 ? 80 : 70), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  await runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
  );

  expect(create).toHaveBeenCalledTimes(11);
  expect(create.mock.calls[1]![0].model).toBe("gpt-5.6-luna");
  expect(statuses.get("envelope-1:narration_section_1_fallback")).toBe("settled");
  expect(statuses.get("envelope-1:narration_global_rewrite")).toBe("released");
  expect(mocks.releaseCostEnvelope).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "envelope-1:narration_global_rewrite", reason: "global_rewrite_not_needed" }));
});

it("uses the global Flash replacement once, then stops after a later dual quality failure and releases every unused row", async () => {
  const statuses = setPersistedReservationMocks();
  const create = vi.fn().mockImplementation(async () => {
    const call = create.mock.calls.length;
    if ([1, 2, 5, 6].includes(call)) return { output_text: `${call <= 2 ? 1 : 3}. Too short\nNo.`, usage: { input_tokens: 1, output_tokens: 1 } };
    const order = call === 3 ? 1 : call === 4 ? 2 : 3;
    return { output_text: sectionText(order, order === 1 ? 60 : 70), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  await expect(runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
  )).rejects.toThrow("narration_quality_failure");

  expect(create).toHaveBeenCalledTimes(6);
  expect(create.mock.calls.slice(0, 3).map(([request]) => request.model)).toEqual(Array(3).fill("gpt-5.6-luna"));
  expect(statuses.get("envelope-1:narration_global_rewrite")).toBe("settled");
  expect(statuses.get("envelope-1:narration_section_3_candidate")).toBe("settled");
  expect(statuses.get("envelope-1:narration_section_3_fallback")).toBe("settled");
  for (let slideOrder = 4; slideOrder <= 10; slideOrder += 1) {
    expect(statuses.get(`envelope-1:narration_section_${slideOrder}_candidate`)).toBe("released");
    expect(statuses.get(`envelope-1:narration_section_${slideOrder}_fallback`)).toBe("released");
  }
});

it("logs floor-aware word bounds and does not request a second global rewrite after slide 3", async () => {
  const statuses = setPersistedReservationMocks();
  const logged: unknown[] = [];
  const info = vi.spyOn(logger, "info").mockImplementation((payload: unknown) => {
    logged.push(payload);
    return logger;
  });
  const create = vi.fn().mockImplementation(async () => {
    const call = create.mock.calls.length;
    if ([3, 4, 8, 9].includes(call)) {
      const slideOrder = call <= 4 ? 3 : 6;
      return { output_text: `${slideOrder}. Too short\nNo.`, usage: { input_tokens: 1, output_tokens: 1 } };
    }
    const slideOrder = call === 5 ? 3 : call < 3 ? call : call - 2;
    const words = slideOrder === 1 ? 60 : slideOrder === 10 ? 80 : 70;
    return { output_text: sectionText(slideOrder, words), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  try {
    await expect(runWithUsageContext(
      { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
      () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
    )).rejects.toThrow("narration_quality_failure");

    expect(create).toHaveBeenCalledTimes(9);
    expect(create.mock.calls.filter(([request]) => request.model === "gpt-5.6-luna")).toHaveLength(9);
    expect(statuses.get("envelope-1:narration_global_rewrite")).toBe("settled");
    expect(logged).toContainEqual(expect.objectContaining({
      narrationTextCall: 6,
      narrationStage: "narration_section_6_candidate",
      qualityReason: "word_range",
      wordCount: 1,
      effectiveMinWords: 60,
      effectiveMaxWords: 91,
    }));
    expect(JSON.stringify(logged)).not.toContain("Too short");
    expect(JSON.stringify(logged)).not.toContain(project.prompt);
  } finally {
    info.mockRestore();
  }
});

it("does not add a twenty-second call after ten sections meet the new floors", async () => {
  const statuses = setPersistedReservationMocks();
  const create = vi.fn().mockImplementation(async () => {
    const order = create.mock.calls.length;
    const words = order === 1 ? 60 : order === 10 ? 80 : 70;
    return { output_text: sectionText(order, words), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  await runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
  );

  expect(create).toHaveBeenCalledTimes(10);
  expect(statuses.get("envelope-1:narration_global_rewrite")).toBe("released");
  expect(mocks.releaseCostEnvelope).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "envelope-1:narration_global_rewrite" }));
});
