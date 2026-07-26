import { afterEach, expect, it, vi } from "vitest";
import { standardGenerationCostPolicy, type Source } from "@studydeck/shared";

const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  reserveCostEnvelopeBatch: vi.fn(),
}));

vi.mock("../../../prisma.js", () => ({
  getPrisma: () => ({ costEnvelope: { findUniqueOrThrow: mocks.findUniqueOrThrow } }),
}));

vi.mock("../../../cost-envelope.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../cost-envelope.js")>()),
  reserveCostEnvelopeBatch: mocks.reserveCostEnvelopeBatch,
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
