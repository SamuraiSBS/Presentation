import { describe, expect, it, vi } from "vitest";
import {
  classifyGenerationError,
  generationJobOptions,
  narrationJobOptions,
  progressForStage,
  safeErrorSummary,
  generationFailureCategory,
  safeGenerationError,
  publicNarrationFailureState,
  shouldRetryGenerationJob,
  updateGenerationProgress,
} from "./job-progress.js";

describe("generation job progress", () => {
  it("maps stable progress stages to Russian UI labels", () => {
    expect(progressForStage("researching")).toEqual({
      stage: "researching",
      label: "Собираем факты и источники",
      percent: 15,
    });
    expect(progressForStage("completed").percent).toBe(100);
  });

  it("updates BullMQ progress and persistent job progress together", async () => {
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const persist = vi.fn().mockResolvedValue(undefined);

    const payload = await updateGenerationProgress(
      { id: "queue-job-1", updateProgress },
      "building_slides",
      persist,
    );

    expect(payload).toEqual(expect.objectContaining({
      stage: "building_slides",
      label: "Собираем слайды",
      percent: 60,
    }));
    expect(updateProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: "building_slides" }));
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      progressStage: "building_slides",
      progressLabel: "Собираем слайды",
      progressPercent: 60,
      stageStartedAt: expect.any(Date),
    }));
  });
});

describe("generation retry classification", () => {
  it("retries transient network and provider errors", () => {
    expect(classifyGenerationError(new Error("fetch failed: ECONNRESET"))).toBe("transient");
    expect(classifyGenerationError(new Error("Yandex generation request failed: 503 unavailable"))).toBe("transient");
    expect(generationJobOptions().attempts).toBe(3);
  });

  it("makes narration failures final while preserving presentation retries", () => {
    const error = new Error("fetch failed: ECONNRESET");
    expect(narrationJobOptions()).toEqual(expect.objectContaining({ attempts: 1 }));
    expect(narrationJobOptions()).not.toHaveProperty("backoff");
    expect(shouldRetryGenerationJob("narration", error, 0, 1)).toBe(false);
    expect(shouldRetryGenerationJob("presentation", error, 0, 3)).toBe(true);
  });

  it("persists a source-safe terminal reason before narration starts", () => {
    expect(publicNarrationFailureState("narration", "researching")).toBe("source_preparation_failed");
    expect(publicNarrationFailureState("narration", "drafting_speech")).toBe("narration_failed");
    expect(publicNarrationFailureState("presentation", "researching")).toBeNull();
  });

  it("does not retry fatal configuration or accepted narration errors", () => {
    expect(classifyGenerationError(new Error("TAVILY_API_KEY is required for web search generation"))).toBe("fatal");
    expect(classifyGenerationError(new Error("No accepted speech text was found for presentation generation"))).toBe("fatal");
  });

  it("keeps exhausted schema failures separate from network retry", () => {
    const error = new Error("Structured generation for PresentationDocument failed validation");
    error.name = "StructuredGenerationError";

    expect(classifyGenerationError(error)).toBe("repairable_schema");
    expect(generationFailureCategory(error)).toBe("quality");
  });

  it("exposes recovery copy without provider or schema detail", () => {
    const recovery = safeGenerationError(new Error("Yandex returned schema validation error for yandex-secret123456"));
    expect(recovery.category).toBe("quality");
    expect(recovery.message).not.toMatch(/yandex|schema|secret/i);
  });

  it("redacts likely API tokens from safe summaries", () => {
    expect(safeErrorSummary(new Error("provider rejected sk-secret123456"))).toContain("[redacted]");
  });
});
