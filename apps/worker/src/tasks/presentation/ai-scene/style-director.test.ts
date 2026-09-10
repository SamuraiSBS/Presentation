import { describe, expect, it } from "vitest";
import { normalizeDeckStyleSpec } from "./style-director.js";

describe("AI scene style direction", () => {
  it("trims only overlong provider prose before schema validation", () => {
    const normalized = normalizeDeckStyleSpec({
      typography: { title: "t".repeat(120), body: "b".repeat(90), hierarchy: "h".repeat(401) },
      generationPrompt: "p".repeat(600),
      forbiddenTechniques: ["f".repeat(200)],
    }) as { typography: { title: string; body: string; hierarchy: string }; generationPrompt: string; forbiddenTechniques: string[] };
    expect(normalized.typography.title).toHaveLength(80);
    expect(normalized.typography.body).toHaveLength(80);
    expect(normalized.typography.hierarchy).toHaveLength(400);
    expect(normalized.generationPrompt).toHaveLength(480);
    expect(normalized.forbiddenTechniques[0]).toHaveLength(160);
  });
});
