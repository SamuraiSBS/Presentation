import { afterEach, expect, it, vi } from "vitest";
import { standardGenerationCostPolicy, type Source } from "@studydeck/shared";

const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  reserveCostEnvelopeBatch: vi.fn(),
  releaseCostEnvelope: vi.fn(),
  settleCostEnvelope: vi.fn(),
}));

vi.mock("../../../prisma.js", () => ({
  getPrisma: () => ({ costEnvelope: { findUniqueOrThrow: mocks.findUniqueOrThrow } }),
}));

vi.mock("../../../cost-envelope.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../cost-envelope.js")>()),
  reserveCostEnvelopeBatch: mocks.reserveCostEnvelopeBatch,
  releaseCostEnvelope: mocks.releaseCostEnvelope,
  settleCostEnvelope: mocks.settleCostEnvelope,
}));

import { AitunnelProjectBudget, reserveAitunnelStageCall, runWithAitunnelProjectBudget, type AitunnelNarrationSectionStage } from "../../../aitunnel-narration-budget.js";
import { logger } from "../../../observability.js";
import { runWithUsageContext } from "../../../usage-ledger.js";
import { AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT } from "../constants.js";
import { buildAitunnelNarrationGlobalRewritePrompt, buildAitunnelNarrationSectionPrompt, buildAitunnelNarrationSectionReplacementPrompt } from "../prompts/builders.js";
import { generateAitunnelNarration, MAX_AITUNNEL_NARRATION_TEXT_CALLS } from "./generation.js";
import { getFloorAwareSpeechTimingSectionBounds, getRussianStudentSpeechTimingBudget } from "@studydeck/shared";

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
  mocks.reserveCostEnvelopeBatch.mockReset();
  mocks.releaseCostEnvelope.mockReset();
  mocks.settleCostEnvelope.mockReset();
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

it("keeps every grounded runtime section prompt within its persisted candidate and fallback buckets", () => {
  const policy = standardGenerationCostPolicy();

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
  const policy = standardGenerationCostPolicy();
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

it("serially releases every unused reservation after a section quality terminal failure", async () => {
  const policy = standardGenerationCostPolicy();
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
      narrationStage: "narration_section_2_candidate", model: "gemini-3.5-flash-lite", failureCategory: "quality", qualityReason: "word_range",
    }));
    expect(logged).toContainEqual(expect.objectContaining({
      narrationStage: "narration_section_2_fallback", model: "gemini-3.6-flash", failureCategory: "quality", qualityReason: "word_range",
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
  const create = vi.fn().mockImplementation(async (request: { model: string }) => {
    const call = create.mock.calls.length;
    const words = call === 1 ? 72 : call === 10 ? 90 : 126;
    const firstSentenceWords = Math.floor(words / 2);
    return { output_text: `${call}. Verified section\n${Array.from({ length: firstSentenceWords }, (_, index) => `topic${call}_${index}`).join(" ")}. ${Array.from({ length: words - firstSentenceWords }, (_, index) => `detail${call}_${index}`).join(" ")}.`, usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  try {
    await runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan));

    expect(create).toHaveBeenCalledTimes(10);
    expect(create.mock.calls.every(([request]) => request.model === "gemini-3.5-flash-lite")).toBe(true);
    expect(logged.filter((entry) => (entry as { failureCategory?: string }).failureCategory === "quality")).toHaveLength(0);
    expect(logged.every((entry) => (entry as { narrationStage?: string }).narrationStage?.endsWith("_candidate"))).toBe(true);
    expect(new Set(logged.map((entry) => (entry as { narrationStage: string }).narrationStage)).size).toBe(10);
  } finally {
    info.mockRestore();
  }
});

it("rejects the observed 1034-word shape locally and uses only the existing fallback/global path", async () => {
  const statuses = setPersistedReservationMocks();
  const create = vi.fn().mockImplementation(async () => {
    const call = create.mock.calls.length;
    const order = call === 1 ? 1 : call === 2 || call === 3 || call === 4 ? 2 : call - 2;
    const words = order === 1 ? 72 : order === 2 && call < 4 ? 118 : order === 2 ? 126 : order === 10 ? 90 : 126;
    return { output_text: sectionText(order, words), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  await runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
  );

  expect(create).toHaveBeenCalledTimes(12);
  expect(create.mock.calls.slice(0, 4).map(([request]) => request.model)).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.6-flash"]);
  expect(statuses.get("envelope-1:narration_section_2_fallback")).toBe("settled");
  expect(statuses.get("envelope-1:narration_global_rewrite")).toBe("settled");
  expect(MAX_AITUNNEL_NARRATION_TEXT_CALLS).toBe(21);
});

function sectionText(order: number, words: number) {
  const firstSentenceWords = Math.floor(words / 2);
  return `${order}. Verified section\n${Array.from({ length: firstSentenceWords }, (_, index) => `topic${order}_${index}`).join(" ")}. ${Array.from({ length: words - firstSentenceWords }, (_, index) => `detail${order}_${index}`).join(" ")}.`;
}

function setPersistedReservationMocks(policy = standardGenerationCostPolicy()) {
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
    return { output_text: sectionText(order, order === 1 ? 80 : order === 10 ? 100 : 140), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  await runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
  );

  expect(create).toHaveBeenCalledTimes(11);
  expect(create.mock.calls[1]![0].model).toBe("gemini-3.6-flash");
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
    return { output_text: sectionText(order, order === 1 ? 80 : 140), usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const client = { responses: { create } } as never;

  await expect(runWithUsageContext(
    { userId: "user-1", projectId: project.id, costEnvelopeId: "envelope-1" },
    () => runWithAitunnelProjectBudget(new AitunnelProjectBudget(), () => generateAitunnelNarration(client, "gemini-3.6-flash", project, [], plan)),
  )).rejects.toThrow("narration_quality_failure");

  expect(create).toHaveBeenCalledTimes(6);
  expect(create.mock.calls.slice(0, 3).map(([request]) => request.model)).toEqual(["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.6-flash"]);
  expect(statuses.get("envelope-1:narration_global_rewrite")).toBe("settled");
  expect(statuses.get("envelope-1:narration_section_3_candidate")).toBe("settled");
  expect(statuses.get("envelope-1:narration_section_3_fallback")).toBe("settled");
  for (let slideOrder = 4; slideOrder <= 10; slideOrder += 1) {
    expect(statuses.get(`envelope-1:narration_section_${slideOrder}_candidate`)).toBe("released");
    expect(statuses.get(`envelope-1:narration_section_${slideOrder}_fallback`)).toBe("released");
  }
});

it("does not add a twenty-second call after ten sections meet the new floors", async () => {
  const statuses = setPersistedReservationMocks();
  const create = vi.fn().mockImplementation(async () => {
    const order = create.mock.calls.length;
    const words = order === 1 ? 72 : order === 10 ? 90 : 126;
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
