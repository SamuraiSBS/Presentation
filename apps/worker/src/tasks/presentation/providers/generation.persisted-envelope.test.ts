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
import { buildAitunnelNarrationSectionPrompt, buildAitunnelNarrationSectionReplacementPrompt } from "../prompts/builders.js";
import { generateAitunnelNarration } from "./generation.js";

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

    expect(Number(reserveAitunnelStageCall(candidateStage, { input: [{ role: "system", content: AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT }, { role: "user", content: candidate }] })!.costRub))
      .toBeLessThanOrEqual(Number(policy.buckets[candidateStage as keyof typeof policy.buckets]));
    expect(Number(reserveAitunnelStageCall(fallbackStage, { input: [{ role: "system", content: AITUNNEL_NARRATION_SECTION_SYSTEM_PROMPT }, { role: "user", content: fallback }] })!.costRub))
      .toBeLessThanOrEqual(Number(policy.buckets[fallbackStage as keyof typeof policy.buckets]));
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
  expect(inputs).toHaveLength(20);
  expect(new Set(inputs.map((input: { idempotencyKey: string }) => input.idempotencyKey)).size).toBe(20);
  expect(new Set(inputs.map((input: { envelopeId: string }) => input.envelopeId))).toEqual(new Set(["envelope-1"]));
  expect(inputs.map((input: { bucket: string }) => input.bucket)).toEqual(expect.arrayContaining([
    "narration_section_1_candidate",
    "narration_section_1_fallback",
    "narration_section_10_candidate",
    "narration_section_10_fallback",
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
  const acceptedText = `1. Verified section\n${Array.from({ length: 32 }, (_, index) => `evidence${index + 1}`).join(" ")}. ${Array.from({ length: 32 }, (_, index) => `context${index + 1}`).join(" ")}.`;
  const invalidText = "2. Incomplete section\nToo short.";
  const create = vi.fn()
    .mockResolvedValueOnce({ output_text: acceptedText, usage: { input_tokens: 1, output_tokens: 1 } })
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
    expect(create).toHaveBeenCalledTimes(3);
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
    const words = call === 1 ? 80 : call === 10 ? 100 : 140;
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
