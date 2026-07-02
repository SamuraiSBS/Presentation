import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareGenerationSources } from "./generation.js";
import { searchWebSources } from "./web-search.js";

vi.mock("../prisma.js", () => ({
  getPrisma: () => ({
    source: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
  }),
}));

vi.mock("../storage.js", () => ({
  readObjectBuffer: vi.fn(),
}));

vi.mock("./extract.js", () => ({
  extractTextFromSource: vi.fn(),
}));

vi.mock("./image-search.js", () => ({
  enrichPresentationImages: vi.fn(),
}));

vi.mock("./web-search.js", () => ({
  searchWebSources: vi.fn(),
}));

describe("prepareGenerationSources", () => {
  beforeEach(() => {
    vi.mocked(searchWebSources).mockReset();
  });

  it("uses accepted speech text when no uploaded or web sources are available", async () => {
    vi.mocked(searchWebSources).mockResolvedValue([]);

    const sources = await prepareGenerationSources({
      id: "project-caribbean-crisis",
      prompt: "Карибский кризис",
      mode: "with_sources",
      speechDraft: [
        "Слайд 1: Введение в Карибский кризис",
        "Карибский кризис был противостоянием СССР и США в 1962 году. Он стал одним из самых опасных моментов холодной войны. Размещение ракет на Кубе резко повысило риск прямого столкновения. Переговоры позволили сторонам выйти из кризиса. Этот пример показывает, насколько важны дипломатия и контроль над эскалацией.",
      ].join("\n"),
      sources: [],
    });

    expect(sources).toEqual([
      expect.objectContaining({
        id: "project-caribbean-crisis-accepted-speech",
        label: "Accepted speech text",
        type: "PROMPT",
      }),
    ]);
    expect(sources[0].excerpt).toContain("Карибский кризис был противостоянием СССР и США");
  });
});
