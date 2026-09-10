import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  reserve: vi.fn(() => ({ status: "reserved", maxOutputTokens: 2_600 })),
}));

vi.mock("../../../openai-client.js", () => ({
  createAitunnelClient: () => ({ chat: { completions: { create: mocks.create } } }),
}));
vi.mock("../../../aitunnel-narration-budget.js", () => ({
  currentAitunnelProjectBudget: () => ({ reserve: mocks.reserve, settle: () => ({ status: "settled", actualCostRub: "0.1" }) }),
}));
vi.mock("../../../usage-ledger.js", () => ({ normalizeOpenAIUsage: () => ({ inputTokens: 10, outputTokens: 20 }), recordAiUsage: vi.fn() }));
vi.mock("./provider-cost.js", () => ({ aitunnelReportedCostRub: () => "0.1" }));

import { analyzeScene } from "./scene-analyzer.js";

describe("AI scene analysis request", () => {
  it("uses minimal reasoning so the bounded JSON response is not starved", async () => {
    mocks.create.mockReturnValue({ withResponse: async () => ({
      data: { id: "scene-1", usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        version: 2, slideId: "slide-1", background: { color: "#08111F", prompt: "text-free deep blue space background with a quiet title area" }, elements: [
          { type: "text", id: "title", textRef: "title", role: "title", x: 50, y: 50, w: 500, h: 80, fontSize: 48, color: "#FFFFFF" },
          { type: "text", id: "thesis", textRef: "thesis", role: "thesis", x: 50, y: 150, w: 500, h: 90, fontSize: 28, color: "#DDEBFF" },
          { type: "shape", id: "wash", shape: "roundRect", x: 30, y: 30, w: 560, h: 240, fill: "#08111F", stroke: "#08111F" },
        ],
      }) } }] },
      response: { headers: new Headers() },
    }) });
    const prototypeBudget = { reserve: vi.fn(() => ({ status: "reserved" })), settle: vi.fn(() => ({ status: "settled" })) } as any;
    await analyzeScene("aitunnel", {
      lock: { slideId: "slide-1", slideOrder: 1, composition: "statement", title: "Система", thesis: "Тезис", text: [{ key: "title", text: "Система" }, { key: "thesis", text: "Тезис" }], facts: [], contentHash: "a".repeat(64) },
      style: { version: 1, palette: { background: "#08111F", surface: "#112233", text: "#FFFFFF", mutedText: "#DDEBFF", accent: "#FFCC00", accentSecondary: "#33CCFF" }, atmosphere: "Тёмное учебное космическое пространство", typography: { title: "Arial", body: "Arial", hierarchy: "Крупный заголовок" }, imageStyle: "Реалистичный космос", diagramStyle: "Тонкие линии", whitespaceRule: "Много свободного пространства", allowedEffects: ["glow"], forbiddenTechniques: ["карточки"], generationPrompt: "Premium astronomy editorial design with dark space" },
      conceptPrompt: "concept", conceptImage: await sharp({ create: { width: 16, height: 9, channels: 3, background: "#08111F" } }).jpeg().toBuffer(), costBudget: prototypeBudget,
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ reasoning_effort: "minimal", max_tokens: 2600 }));
  });

  it("uses the separately budgeted scene_repair stage exactly when diagnostics are supplied", async () => {
    mocks.create.mockReturnValue({ withResponse: async () => ({
      data: { id: "scene-repair", usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        version: 2, slideId: "slide-1", background: { color: "#08111F", prompt: "text-free deep blue space background with a quiet title area" }, elements: [
          { type: "text", id: "title", textRef: "title", role: "title", x: 50, y: 50, w: 500, h: 80, fontSize: 48, color: "#FFFFFF" },
          { type: "text", id: "thesis", textRef: "thesis", role: "thesis", x: 50, y: 150, w: 500, h: 90, fontSize: 28, color: "#DDEBFF" },
          { type: "shape", id: "sun", shape: "ellipse", x: 700, y: 220, w: 200, h: 200, fill: "#FFC857", stroke: "#FFC857" },
        ],
      }) } }] }, response: { headers: new Headers() },
    }) });
    const reserve = vi.fn(() => ({ status: "reserved", maxOutputTokens: 2_600 }));
    const prototypeBudget = { reserve: vi.fn(() => ({ status: "reserved" })), settle: vi.fn(() => ({ status: "settled" })) } as any;
    await analyzeScene("aitunnel", { lock: { slideId: "slide-1", slideOrder: 1, composition: "statement", title: "Система", thesis: "Тезис", text: [{ key: "title", text: "Система" }, { key: "thesis", text: "Тезис" }], facts: [], contentHash: "a".repeat(64) }, style: { version: 1, palette: { background: "#08111F", surface: "#112233", text: "#FFFFFF", mutedText: "#DDEBFF", accent: "#FFCC00", accentSecondary: "#33CCFF" }, atmosphere: "Тёмное учебное космическое пространство", typography: { title: "Arial", body: "Arial", hierarchy: "Крупный заголовок" }, imageStyle: "Реалистичный космос", diagramStyle: "Тонкие линии", whitespaceRule: "Много свободного пространства", allowedEffects: ["glow"], forbiddenTechniques: ["карточки"], generationPrompt: "Premium astronomy editorial design with dark space" }, conceptPrompt: "concept", conceptImage: await sharp({ create: { width: 16, height: 9, channels: 3, background: "#08111F" } }).jpeg().toBuffer(), repairDiagnostics: ["title overlaps diagram"], costBudget: prototypeBudget });
    expect(prototypeBudget.reserve).toHaveBeenCalledWith(expect.any(String), "scene_repair");
    expect(mocks.reserve).toHaveBeenCalledWith(expect.any(String), "scene_repair", expect.any(Object));
  });
});
