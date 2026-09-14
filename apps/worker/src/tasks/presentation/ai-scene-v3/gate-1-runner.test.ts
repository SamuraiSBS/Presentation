import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { AI_SCENE_V3_GATE_1_SINGLE_CANDIDATE_COST_POLICY, AiSceneV3Gate1Budget, runAiSceneV3Gate1 } from "./gate-1-runner.js";
import { brief, direction, layout, plan } from "./test-fixtures.js";

const capabilities = {
  provider: "aitunnel" as const,
  model: "gpt-image-2.5-flare",
  endpoint: "https://api.aitunnel.ru/public/aitunnel/models/images",
  fetchedAt: "2026-09-11T00:00:00.000Z",
  supportsGeneration: true,
  supportsImageInput: true,
  supportsEditing: true,
  supportsCombinedResolutionAndAspectRatio: true,
  maxInputReferences: 16,
  qualities: ["xhigh"],
  outputFormats: ["png"],
  sizes: [],
  aspectRatios: [],
  rawModelId: "gpt-image-2.5-flare",
};

function topics() {
  return ["solar", "automotive", "nature"].map((id) => ({
    id,
    brief,
    artDirection: direction,
    plans: [gatePlan("A", "layered_explanation"), gatePlan("B", "comparison")] as const,
    references: [{ id: `${id}-reference`, url: "https://assets.example.test/reference.png" }],
  }));
}

function gatePlan(variant: "A" | "B", type: "layered_explanation" | "comparison") {
  const value = plan(variant, type);
  return {
    ...value,
    textZones: value.textZones.map((entry, index) => ({ ...entry, zone: { x: .08, y: .08 + index * .15, w: .35, h: .1 } })),
    quietZones: [{ x: .08, y: .08, w: .35, h: .85 }],
  };
}

function gateLayout() {
  const textZones = gatePlan("A", "layered_explanation").textZones;
  return {
    ...layout(),
    entries: layout().entries.map((entry, index) => ({
      ...entry,
      x: textZones[index]!.zone.x * 1280,
      y: textZones[index]!.zone.y * 720,
      w: textZones[index]!.zone.w * 1280,
      h: textZones[index]!.zone.h * 720,
      fontSize: entry.semanticId === "title" ? 40 : 24,
    })),
  };
}

function vision(noBrandMarks = true) {
  return {
    noUnexpectedVisibleText: true,
    allowedVisibleTextIds: ["title", ...brief.anchors.map((anchor) => anchor.id), "conclusion"],
    noBakedTextInBackground: true,
    noBrandMarks,
    anchorEvidence: brief.anchors.map((anchor) => ({ anchorId: anchor.id, visualRegion: "visible planet", confidence: .9, detail: "visible distinct object" })),
    scores: { semanticClarity: 90, visualQuality: 90, textIntegration: 90, styleConsistency: 90, compositionStrength: 90, referenceLevel: 90, deckDiversity: 90 },
    diagnostics: noBrandMarks ? [] : ["critical:brand_mark_detected"],
  };
}

describe("AI Scene v3 Gate 1 runner", () => {
  it("runs background, native text, exact preview, high-detail vision and export gates before review", async () => {
    const png = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const saved: Array<{ background: Buffer; preview: Buffer }> = [];
    const generate = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("Never depict brand identifiers");
      return { buffer: png, contentType: "image/png" as const, model: "gpt-image-2.5-flare", costRub: "1.00" };
    });
    const manifest = await runAiSceneV3Gate1({
      env: { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" }, capabilities, topics: topics(),
    }, {
      generate,
      nativeTextLayout: async ({ prompt }) => {
        expect(prompt).toContain("attached exact 16:9 PNG at high detail");
        return { value: gateLayout(), costRub: "1.00" };
      },
      highDetailVision: async ({ prompt, preview }) => {
        expect(prompt).toContain("critical:brand_mark_detected");
        expect((await sharp(preview).metadata()).width).toBe(1280);
        return { value: vision(), costRub: "1.00" };
      },
      saveBackground: async ({ background, topic, plan: compositionPlan }) => {
        saved.push({ background, preview: Buffer.alloc(0) });
        return { backgroundObjectKey: `gate-1/${topic.id}/${compositionPlan.variant}/background.png`, url: "https://assets.example.test/background.png" };
      },
      savePreview: async ({ preview }) => {
        saved[saved.length - 1]!.preview = preview;
        return { renderedPreviewObjectKey: "gate-1/native-preview.png" };
      },
      assertExportCompatibility: async () => true,
    });

    expect(manifest.status).toBe("review_required");
    expect(manifest.stopGo).toBe("no_go_pending_human_review");
    expect(manifest.candidates).toHaveLength(6);
    expect(manifest.candidates.every((candidate) => candidate.status === "passed")).toBe(true);
    expect(saved).toHaveLength(6);
    expect(generate).toHaveBeenCalledTimes(6);
    for (const id of ["solar", "automotive", "nature"]) {
      expect(new Set(manifest.candidates.filter((candidate) => candidate.topic === id).map((candidate) => candidate.compositionType)).size).toBe(2);
    }
  });

  it("writes the brand-mark diagnostic and blocks the whole Gate 1 result", async () => {
    const png = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const manifest = await runAiSceneV3Gate1({
      env: { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" }, capabilities, topics: topics(),
    }, {
      generate: async () => ({ buffer: png, contentType: "image/png", model: "gpt-image-2.5-flare", costRub: "1.00" }),
      nativeTextLayout: async () => ({ value: gateLayout(), costRub: "1.00" }),
      highDetailVision: async () => ({ value: vision(false), costRub: "1.00" }),
      saveBackground: async ({ topic, plan: compositionPlan }) => ({ backgroundObjectKey: `${topic.id}-${compositionPlan.variant}-background.png`, url: "https://assets.example.test/background.png" }),
      savePreview: async ({ topic, plan: compositionPlan }) => ({ renderedPreviewObjectKey: `${topic.id}-${compositionPlan.variant}-preview.png` }),
      assertExportCompatibility: async () => true,
    });
    expect(manifest.status).toBe("failed");
    expect(manifest.candidates[0]?.qualityReport?.hardChecks.noBrandMarks).toMatchObject({ passed: false, detail: "critical:brand_mark_detected" });
    expect(manifest.candidates[0]?.diagnostics).toContain("critical:brand_mark_detected");
  });

  it("does not allow a seventh candidate or a hidden C inside the shared envelope", () => {
    const budget = new AiSceneV3Gate1Budget({ version: "ai-scene-v3-gate-1-v1", limitRub: "150.00000000", buckets: { backgrounds: "90.00000000", native_text_layout: "24.00000000", high_detail_vision: "36.00000000" } });
    for (let index = 0; index < 6; index += 1) budget.reserve("backgrounds");
    expect(() => budget.reserve("backgrounds")).toThrow("ai_scene_v3_gate_1_backgrounds_envelope_exhausted");
  });

  it("keeps a separately authorised single-candidate retry inside its 25-RUB envelope", () => {
    const budget = new AiSceneV3Gate1Budget(AI_SCENE_V3_GATE_1_SINGLE_CANDIDATE_COST_POLICY);
    budget.reserve("backgrounds");
    budget.reserve("native_text_layout");
    budget.reserve("high_detail_vision");
    expect(budget.reservedRub).toBe("25.00000000");
    expect(() => budget.reserve("backgrounds")).toThrow("ai_scene_v3_gate_1_backgrounds_envelope_exhausted");
  });

  it("can stop after one separately authorised A candidate without starting B or another topic", async () => {
    const png = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const generate = vi.fn(async () => ({ buffer: png, contentType: "image/png" as const, model: "gpt-image-2.5-flare", costRub: "1.00" }));
    const manifest = await runAiSceneV3Gate1({
      env: { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" }, capabilities, topics: topics(), candidateLimit: 1,
    }, {
      generate,
      nativeTextLayout: async () => ({ value: gateLayout(), costRub: "1.00" }),
      highDetailVision: async () => ({ value: vision(), costRub: "1.00" }),
      saveBackground: async ({ topic, plan: compositionPlan }) => ({ backgroundObjectKey: `${topic.id}-${compositionPlan.variant}-background.png`, url: "https://assets.example.test/background.png" }),
      savePreview: async ({ topic, plan: compositionPlan }) => ({ renderedPreviewObjectKey: `${topic.id}-${compositionPlan.variant}-preview.png` }),
      assertExportCompatibility: async () => true,
    });
    expect(manifest.status).toBe("review_required");
    expect(manifest.candidates).toHaveLength(1);
    expect(manifest.candidates[0]).toMatchObject({ topic: "solar", variant: "A", status: "passed" });
    expect(manifest.diagnostics).toContain("candidate_limit_reached_no_remaining_candidates_started");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("hard-stops an oversized actual title before preview or high-detail vision", async () => {
    const png = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const highDetailVision = vi.fn(async () => ({ value: vision(), costRub: "1.00" }));
    const manifest = await runAiSceneV3Gate1({
      env: { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" }, capabilities, topics: topics(), candidateLimit: 1,
    }, {
      generate: async () => ({ buffer: png, contentType: "image/png", model: "gpt-image-2.5-flare", costRub: "1.00" }),
      nativeTextLayout: async () => ({ value: {
        ...gateLayout(),
        entries: gateLayout().entries.map((entry) => entry.semanticId === "title" ? { ...entry, fontSize: 72 } : entry),
      }, costRub: "1.00" }),
      highDetailVision,
      saveBackground: async ({ topic, plan: compositionPlan }) => ({ backgroundObjectKey: `${topic.id}-${compositionPlan.variant}-background.png`, url: "https://assets.example.test/background.png" }),
      savePreview: async ({ topic, plan: compositionPlan }) => ({ renderedPreviewObjectKey: `${topic.id}-${compositionPlan.variant}-preview.png` }),
      assertExportCompatibility: async () => true,
    });
    expect(highDetailVision).not.toHaveBeenCalled();
    expect(manifest.actualRub).toBe("2.00000000");
    expect(manifest.candidates[0]?.diagnostics[0]).toContain("ai_scene_v3_gate_1_native_text_layout_failed:ai_scene_v3_text_layout_unreadable:title:font_size_must_equal_40px,text_does_not_fit");
    expect(manifest.diagnostics).toContain("candidate_failed_hard_stop_remaining_gate_1_candidates_not_started");
  });

  it("settles a provider-reported layout cost even when its JSON is malformed", async () => {
    const png = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const manifest = await runAiSceneV3Gate1({ env: { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" }, capabilities, topics: topics() }, {
      generate: async () => ({ buffer: png, contentType: "image/png", model: "gpt-image-2.5-flare", costRub: "1.00" }),
      nativeTextLayout: async () => { throw Object.assign(new Error("malformed_json"), { costRub: "0.25" }); },
      highDetailVision: async () => ({ value: vision(), costRub: "1.00" }),
      saveBackground: async ({ topic, plan: compositionPlan }) => ({ backgroundObjectKey: `${topic.id}-${compositionPlan.variant}-background.png`, url: "https://assets.example.test/background.png" }),
      savePreview: async ({ topic, plan: compositionPlan }) => ({ renderedPreviewObjectKey: `${topic.id}-${compositionPlan.variant}-preview.png` }),
      assertExportCompatibility: async () => true,
    });
    expect(manifest.actualRub).toBe("1.25000000");
    expect(manifest.candidates[0]?.cost).toMatchObject({ backgroundRub: "1.00000000", nativeTextLayoutRub: "0.25000000" });
    expect(manifest.uncertainRub).toBe("0.00000000");
  });

  it("persists the background and records a bounded uncertain charge before a layout transport failure", async () => {
    const png = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const progress: string[] = [];
    const manifest = await runAiSceneV3Gate1({ env: { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" }, capabilities, topics: topics() }, {
      generate: async () => ({ buffer: png, contentType: "image/png", model: "gpt-image-2.5-flare", costRub: "1.00" }),
      nativeTextLayout: async () => { throw new Error("layout_transport_abort"); },
      highDetailVision: async () => ({ value: vision(), costRub: "1.00" }),
      saveBackground: async ({ topic, plan: compositionPlan }) => ({ backgroundObjectKey: `${topic.id}-${compositionPlan.variant}-background.png`, url: "https://assets.example.test/background.png" }),
      savePreview: async ({ topic, plan: compositionPlan }) => ({ renderedPreviewObjectKey: `${topic.id}-${compositionPlan.variant}-preview.png` }),
      assertExportCompatibility: async () => true,
      onProgress: (snapshot) => { progress.push(JSON.stringify(snapshot)); },
    });
    expect(manifest.uncertainRub).toBe("4.00000000");
    expect(manifest.candidates[0]?.artifacts?.backgroundObjectKey).toContain("solar-A-background.png");
    expect(manifest.candidates[0]?.cost.uncertainUpperBoundRub).toBe("4.00000000");
    expect(manifest.candidates[0]?.diagnostics[0]).toContain("ai_scene_v3_gate_1_native_text_layout_failed:layout_transport_abort");
    expect(progress.some((item) => item.includes("solar-A-background.png"))).toBe(true);
    expect(manifest.diagnostics).toContain("candidate_failed_hard_stop_remaining_gate_1_candidates_not_started");
  });
});
