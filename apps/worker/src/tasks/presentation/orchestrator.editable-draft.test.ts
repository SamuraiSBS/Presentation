import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureGenerationError: vi.fn(),
  loggerWarn: vi.fn(),
  currentUsageContext: vi.fn(),
  aitunnelConfig: vi.fn(),
  createAitunnelClient: vi.fn(),
  createOpenAIClient: vi.fn(),
  runWithAitunnelProjectBudget: vi.fn(),
  selectAiProviders: vi.fn(),
  generateAitunnelFullNarrationOutcome: vi.fn(),
  generateAitunnelPresentationFromNarration: vi.fn(),
  generateAitunnelNarration: vi.fn(),
  generateOpenAINarration: vi.fn(),
  generateYandexNarration: vi.fn(),
  generateNarrativePlanWithProvider: vi.fn(),
  buildResearchBrief: vi.fn(),
  buildDeckStory: vi.fn(),
  buildDesignBrief: vi.fn(),
  buildSlideTextPlans: vi.fn(),
  generationPipelineArtifactsParse: vi.fn(),
}));

vi.mock("../../observability.js", () => ({
  captureGenerationError: mocks.captureGenerationError,
  errorLogFields: () => ({}),
  logger: { warn: mocks.loggerWarn, info: vi.fn(), error: vi.fn() },
}));

vi.mock("../../usage-ledger.js", () => ({
  currentUsageContext: mocks.currentUsageContext,
  normalizeOpenAIUsage: vi.fn(),
  recordAiUsage: vi.fn(),
}));

vi.mock("../../openai-client.js", () => ({
  aitunnelConfig: mocks.aitunnelConfig,
  createAitunnelClient: mocks.createAitunnelClient,
  createOpenAIClient: mocks.createOpenAIClient,
}));

vi.mock("../../aitunnel-narration-budget.js", () => ({
  AitunnelProjectBudget: class AitunnelProjectBudget {},
  runWithAitunnelProjectBudget: mocks.runWithAitunnelProjectBudget,
}));

vi.mock("./providers/provider-selection.js", () => ({
  selectAiProviders: mocks.selectAiProviders,
}));

vi.mock("./providers/generation.js", () => ({
  generateWithAitunnel: vi.fn(),
  generateWithOpenAI: vi.fn(),
  generateAitunnelPresentationFromNarration: mocks.generateAitunnelPresentationFromNarration,
  generateOpenAIPresentationFromNarration: vi.fn(),
  generateAitunnelNarration: mocks.generateAitunnelNarration,
  generateAitunnelFullNarrationOutcome: mocks.generateAitunnelFullNarrationOutcome,
  generateOpenAINarration: mocks.generateOpenAINarration,
  generateWithYandex: vi.fn(),
  generateYandexPresentationFromNarration: vi.fn(),
  generateYandexNarration: mocks.generateYandexNarration,
  generateNarrativePlanWithProvider: mocks.generateNarrativePlanWithProvider,
}));

vi.mock("./planning/builders.js", () => ({
  buildResearchBrief: mocks.buildResearchBrief,
  buildDesignBrief: mocks.buildDesignBrief,
  buildDeckStory: mocks.buildDeckStory,
  buildSlideBlueprints: vi.fn(),
  buildSlideTextPlans: mocks.buildSlideTextPlans,
  normalizeNarrativePlan: vi.fn(),
}));

vi.mock("./narration/processing.js", () => ({
  normalizeNarrationText: vi.fn((value: string) => value),
  parseNarrationSections: vi.fn(),
}));

vi.mock("./normalization/presentation.js", () => ({
  normalizePresentation: vi.fn(),
}));

vi.mock("./quality/orchestration.js", () => ({
  assertPresentationQuality: vi.fn(),
  isDemoGenerationAllowed: () => false,
}));

vi.mock("./utilities.js", () => ({
  buildFallbackGeneratedText: vi.fn(),
  demoPresentation: vi.fn(),
}));

vi.mock("@studydeck/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@studydeck/shared")>();
  return {
    ...original,
    generationPipelineArtifactsSchema: { parse: mocks.generationPipelineArtifactsParse },
  };
});

const { generateNarrationDraft, generatePresentationFromNarration } = await import("./orchestrator.js");

const project = {
  id: "editable-draft-project",
  title: "Editable draft",
  prompt: "Prepare an editable speech draft",
  scenario: "report",
  level: "university_student",
  mode: "with_sources",
  slideCount: 10,
};

const sources = [{
  id: "source-1",
  label: "Source",
  type: "TXT",
  size: 0,
  excerpt: "Grounded evidence.",
  text: "",
  included: true,
}];

const narrativePlan = [{
  slideOrder: 1,
  slideTitle: "Introduction",
  slidePurpose: "Introduce the topic.",
  keyMessage: "The topic has an editable speech draft.",
  audienceQuestion: "Why does this matter?",
  transitionToNext: "",
}];

const originalEnv = { ...process.env };

describe("v6 editable narration persistence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mocks.aitunnelConfig.mockReturnValue({ apiKey: "test-key", baseURL: "https://example.test", narrationModel: "gemini-3.6-flash" });
    mocks.createAitunnelClient.mockReturnValue({});
    mocks.createOpenAIClient.mockReturnValue({});
    mocks.runWithAitunnelProjectBudget.mockImplementation(async (_budget, callback) => callback());
    mocks.buildResearchBrief.mockReturnValue({});
    mocks.buildDeckStory.mockReturnValue({});
    mocks.buildDesignBrief.mockReturnValue({});
    mocks.generateNarrativePlanWithProvider.mockResolvedValue(narrativePlan);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a v6 editable draft before invalid presentation artifacts can be built or parsed", async () => {
    const editableText = "Editable narration text kept only in the result.";
    mocks.selectAiProviders.mockReturnValue(["aitunnel"]);
    mocks.currentUsageContext.mockReturnValue({ costEnvelopePolicyVersion: "standard-generation-cost-envelope-v6" });
    mocks.generateAitunnelFullNarrationOutcome.mockResolvedValue({
      kind: "editable_draft",
      text: editableText,
      stage: "narration_full_candidate",
    });
    mocks.buildSlideTextPlans.mockImplementation(() => {
      throw new Error("presentation artifact construction must not run for editable drafts");
    });
    mocks.generationPipelineArtifactsParse.mockImplementation(() => {
      throw new Error("presentation artifact validation must not run for editable drafts");
    });

    await expect(generateNarrationDraft(project, sources)).resolves.toEqual({
      text: editableText,
      narrativePlan,
      generationMode: "aitunnel",
      narrationOutcome: {
        kind: "editable_draft",
        text: editableText,
        stage: "narration_full_candidate",
      },
    });

    expect(mocks.generateAitunnelNarration).not.toHaveBeenCalled();
    expect(mocks.buildSlideTextPlans).not.toHaveBeenCalled();
    expect(mocks.generationPipelineArtifactsParse).not.toHaveBeenCalled();
    expect(mocks.captureGenerationError).not.toHaveBeenCalled();
  });

  it("returns v6 accepted narration before presentation artifacts can be built or parsed", async () => {
    mocks.selectAiProviders.mockReturnValue(["aitunnel"]);
    mocks.currentUsageContext.mockReturnValue({ costEnvelopePolicyVersion: "standard-generation-cost-envelope-v6" });
    mocks.generateAitunnelFullNarrationOutcome.mockResolvedValue({
      kind: "accepted",
      text: "Accepted narration text.",
      stage: "narration_full_candidate",
    });
    mocks.buildSlideTextPlans.mockReturnValue([]);
    mocks.generationPipelineArtifactsParse.mockImplementation(() => {
      throw new Error("presentation artifact construction must not run for accepted narration");
    });

    await expect(generateNarrationDraft(project, sources)).resolves.toEqual({
      text: "Accepted narration text.",
      narrativePlan,
      generationMode: "aitunnel",
      narrationOutcome: {
        kind: "accepted",
        text: "Accepted narration text.",
        stage: "narration_full_candidate",
      },
    });

    expect(mocks.generateAitunnelNarration).not.toHaveBeenCalled();
    expect(mocks.buildSlideTextPlans).not.toHaveBeenCalled();
    expect(mocks.generationPipelineArtifactsParse).not.toHaveBeenCalled();
  });

  it("routes the accepted AITunnel narration into the provider-backed final document", async () => {
    const generated = { id: "provider-document", generationMode: "aitunnel" };
    mocks.selectAiProviders.mockReturnValue(["aitunnel"]);
    mocks.generateAitunnelPresentationFromNarration.mockResolvedValue(generated);

    await expect(generatePresentationFromNarration(project, sources, "Accepted narration text.")).resolves.toBe(generated);

    expect(mocks.generateAitunnelPresentationFromNarration).toHaveBeenCalledWith(project, sources, "Accepted narration text.");
  });

  it("keeps legacy AITUNNEL narration on its existing artifact-validation path", async () => {
    mocks.selectAiProviders.mockReturnValue(["aitunnel"]);
    mocks.currentUsageContext.mockReturnValue({ costEnvelopePolicyVersion: "standard-generation-cost-envelope-v5" });
    mocks.generateAitunnelNarration.mockResolvedValue("Legacy narration text.");
    mocks.buildSlideTextPlans.mockReturnValue([]);
    mocks.generationPipelineArtifactsParse.mockImplementation(() => {
      throw new Error("invalid presentation artifacts");
    });

    await expect(generateNarrationDraft(project, sources)).rejects.toThrow("invalid presentation artifacts");

    expect(mocks.generateAitunnelFullNarrationOutcome).not.toHaveBeenCalled();
    expect(mocks.generateAitunnelNarration).toHaveBeenCalledTimes(1);
    expect(mocks.buildSlideTextPlans).toHaveBeenCalledTimes(1);
    expect(mocks.generationPipelineArtifactsParse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["openai", "generateOpenAINarration"],
    ["yandex", "generateYandexNarration"],
  ] as const)("keeps %s narration on the existing artifact-validation path", async (provider, narrationGenerator) => {
    mocks.selectAiProviders.mockReturnValue([provider]);
    mocks.buildSlideTextPlans.mockReturnValue([]);
    mocks.generationPipelineArtifactsParse.mockImplementation(() => {
      throw new Error("invalid presentation artifacts");
    });
    if (provider === "openai") {
      mocks.generateOpenAINarration.mockResolvedValue("OpenAI narration text.");
    } else {
      process.env.YANDEX_API_KEY = "test-key";
      mocks.generateYandexNarration.mockResolvedValue("Yandex narration text.");
    }

    await expect(generateNarrationDraft(project, sources)).rejects.toThrow("AI narration generation failed");

    expect(mocks[narrationGenerator]).toHaveBeenCalledTimes(1);
    expect(mocks.buildSlideTextPlans).toHaveBeenCalledTimes(1);
    expect(mocks.generationPipelineArtifactsParse).toHaveBeenCalledTimes(1);
  });
});
