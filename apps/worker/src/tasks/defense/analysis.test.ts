import { describe, expect, it } from "vitest";
import { analyzeDefenseCandidates } from "./analysis.js";

const chunks = [{
  id: "source-1:0",
  sourceId: "source-1",
  sourceRole: "project_document",
  locator: "абзац 1",
  excerpt: "Сервис формирует презентации.",
  text: "Сервис формирует презентации из документов пользователя.",
}];

describe("defense candidate analysis", () => {
  it("never confirms a model fact without real evidence", async () => {
    const result = await analyzeDefenseCandidates(chunks, {
      generate: async () => ({
        facts: [
          { key: "supported", statement: "Сервис формирует презентации.", evidenceChunkIds: ["source-1:0"] },
          { key: "invented", statement: "Сервис имеет миллион пользователей.", evidenceChunkIds: ["missing"] },
          { key: "borrowed-id", statement: "Сервис получил награду и 98% рекомендаций.", evidenceChunkIds: ["source-1:0"] },
        ],
        requirements: [],
      }),
    });

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].key).toBe("supported");
  });

  it("keeps literal source evidence in deterministic fallback", async () => {
    const result = await analyzeDefenseCandidates(chunks, { providers: [] });
    expect(result.provider).toBe("deterministic");
    expect(result.facts[0]).toMatchObject({ evidenceChunkIds: ["source-1:0"] });
  });
});
