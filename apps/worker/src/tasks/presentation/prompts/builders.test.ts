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
});
