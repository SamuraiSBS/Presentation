import { afterEach, describe, expect, it, vi } from "vitest";
import { getYandexModelConfig } from "./builders.js";

describe("Yandex model routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps Pro as the primary model and routes economy work to Lite 5", () => {
    vi.stubEnv("YANDEX_FOLDER_ID", "folder-id");
    vi.stubEnv("YANDEX_MODEL_URI", "");
    vi.stubEnv("YANDEX_MODEL_NAME", "yandexgpt-5-pro");
    vi.stubEnv("YANDEX_ECONOMY_MODEL_URI", "");
    vi.stubEnv("YANDEX_ECONOMY_MODEL_NAME", "yandexgpt-5-lite");

    expect(getYandexModelConfig()).toEqual({ model: "yandexgpt-5-pro", uri: "gpt://folder-id/yandexgpt-5-pro/latest" });
    expect(getYandexModelConfig("economy")).toEqual({ model: "yandexgpt-5-lite", uri: "gpt://folder-id/yandexgpt-5-lite" });
  });

  it("preserves the primary route for narration when no candidate override is set", () => {
    vi.stubEnv("YANDEX_FOLDER_ID", "folder-id");
    vi.stubEnv("YANDEX_MODEL_URI", "");
    vi.stubEnv("YANDEX_MODEL_NAME", "yandexgpt");
    vi.stubEnv("YANDEX_NARRATION_MODEL_URI", "");
    vi.stubEnv("YANDEX_NARRATION_MODEL_NAME", "");

    expect(getYandexModelConfig("narration")).toEqual({ model: "yandexgpt", uri: "gpt://folder-id/yandexgpt/latest" });
  });

  it("allows an explicit candidate for narration without changing primary or economy routes", () => {
    vi.stubEnv("YANDEX_FOLDER_ID", "folder-id");
    vi.stubEnv("YANDEX_MODEL_URI", "");
    vi.stubEnv("YANDEX_MODEL_NAME", "yandexgpt");
    vi.stubEnv("YANDEX_ECONOMY_MODEL_URI", "");
    vi.stubEnv("YANDEX_ECONOMY_MODEL_NAME", "yandexgpt-5-lite");
    vi.stubEnv("YANDEX_NARRATION_MODEL_URI", "");
    vi.stubEnv("YANDEX_NARRATION_MODEL_NAME", "yandexgpt-5-pro");

    expect(getYandexModelConfig("narration")).toEqual({ model: "yandexgpt-5-pro", uri: "gpt://folder-id/yandexgpt-5-pro" });
    expect(getYandexModelConfig("primary")).toEqual({ model: "yandexgpt", uri: "gpt://folder-id/yandexgpt/latest" });
    expect(getYandexModelConfig("economy")).toEqual({ model: "yandexgpt-5-lite", uri: "gpt://folder-id/yandexgpt-5-lite" });
  });

  it("fails before a provider call for incomplete or invalid narration overrides", () => {
    vi.stubEnv("YANDEX_NARRATION_MODEL_NAME", "");
    vi.stubEnv("YANDEX_NARRATION_MODEL_URI", "gpt://folder-id/yandexgpt-5-pro/latest");
    expect(() => getYandexModelConfig("narration")).toThrow("YANDEX_NARRATION_MODEL_NAME is required");

    vi.stubEnv("YANDEX_NARRATION_MODEL_NAME", "not a model");
    vi.stubEnv("YANDEX_NARRATION_MODEL_URI", "");
    expect(() => getYandexModelConfig("narration")).toThrow("supported Yandex model identifier");
  });
});
