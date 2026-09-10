import { describe, expect, it } from "vitest";
import { AI_SCENE_IMAGE_TIMEOUT_MS, aiSceneImageEnv } from "./image-timeout.js";

describe("AI scene image timeout", () => {
  it("does not inherit the legacy short image timeout", () => {
    expect(aiSceneImageEnv({ PRESENTATION_IMAGE_TIMEOUT_MS: "8000" }).AITUNNEL_IMAGE_TIMEOUT_MS).toBe(String(AI_SCENE_IMAGE_TIMEOUT_MS));
    expect(aiSceneImageEnv({ AI_SCENE_IMAGE_TIMEOUT_MS: "120000" }).AITUNNEL_IMAGE_TIMEOUT_MS).toBe("120000");
    expect(aiSceneImageEnv({ AI_SCENE_IMAGE_TIMEOUT_MS: "1" }).AITUNNEL_IMAGE_TIMEOUT_MS).toBe("30000");
  });
});
