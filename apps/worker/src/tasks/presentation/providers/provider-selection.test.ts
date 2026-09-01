import { describe, expect, it } from "vitest";
import { selectAiProviders } from "./provider-selection.js";

describe("selectAiProviders", () => {
  it("selects only explicitly configured AITUNNEL", () => {
    expect(selectAiProviders({ AI_PROVIDER: "aitunnel", AITUNNEL_API_KEY: "key", AITUNNEL_NARRATION_MODEL: "gpt-5.6-luna", OPENAI_API_KEY: "openai", YANDEX_API_KEY: "yandex", YANDEX_FOLDER_ID: "folder" })).toEqual(["aitunnel"]);
  });

  it.each([
    { AI_PROVIDER: "aitunnel" },
    { AI_PROVIDER: "aitunnel", AITUNNEL_API_KEY: "key", AITUNNEL_NARRATION_MODEL: "" },
    { AI_PROVIDER: "aitunnel", AITUNNEL_API_KEY: "key", AITUNNEL_NARRATION_MODEL: "auto" },
  ])("rejects invalid AITUNNEL configuration", (env) => {
    expect(selectAiProviders(env)).toEqual([]);
  });

  it("never adds AITUNNEL to OpenAI, Yandex, or implicit routing", () => {
    const configured = { AITUNNEL_API_KEY: "key", AITUNNEL_NARRATION_MODEL: "gpt-5.6-luna", OPENAI_API_KEY: "openai", YANDEX_API_KEY: "yandex", YANDEX_FOLDER_ID: "folder" };
    expect(selectAiProviders({ ...configured, AI_PROVIDER: "openai" })).toEqual(["openai"]);
    expect(selectAiProviders({ ...configured, AI_PROVIDER: "yandex" })).toEqual(["yandex"]);
    expect(selectAiProviders(configured)).toEqual(["openai", "yandex"]);
  });
});
