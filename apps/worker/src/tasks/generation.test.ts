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

  it("uses existing extracted sources without network search", async () => {
    const sources = await prepareGenerationSources({
      id: "project-with-notes",
      prompt: "AI in education",
      mode: "standard",
      speechDraft: null,
      sources: [{
        id: "source-1",
        label: "Lecture notes",
        type: "TXT",
        size: 200,
        objectKey: null,
        url: null,
        excerpt: "AI helps universities personalize feedback and automate routine checks.",
        text: "",
      }],
    });

    expect(searchWebSources).not.toHaveBeenCalled();
    expect(sources).toEqual([
      expect.objectContaining({
        id: "source-1",
        label: "Lecture notes",
        type: "TXT",
        excerpt: "AI helps universities personalize feedback and automate routine checks.",
      }),
    ]);
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

  it("fails clearly when no source or accepted speech fallback exists", async () => {
    vi.mocked(searchWebSources).mockResolvedValue([]);

    await expect(prepareGenerationSources({
      id: "project-empty",
      prompt: "Short topic",
      mode: "with_sources",
      speechDraft: "",
      sources: [],
    })).rejects.toThrow("No source material was found for generation");
  });
});
