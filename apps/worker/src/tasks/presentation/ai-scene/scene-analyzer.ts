import {
  aiSceneSpecSchema,
  type AiSceneSpec,
  type DeckStyleSpec,
  type SlideContentLock,
} from "@studydeck/shared";
import sharp from "sharp";
import { createAitunnelClient } from "../../../openai-client.js";
import { currentAitunnelProjectBudget } from "../../../aitunnel-narration-budget.js";
import { normalizeOpenAIUsage, recordAiUsage } from "../../../usage-ledger.js";
import type { AiScenePrototypeBudget } from "./prototype-budget.js";
import { aitunnelReportedCostRub } from "./provider-cost.js";

type Provider = "openai" | "yandex" | "aitunnel";

/** The persisted scene contract needs room for coordinates, but not prose. */
export const SCENE_ANALYSIS_MAX_OUTPUT_TOKENS = 2_600;

export function compactSceneAnalysisContract(composition: SlideContentLock["composition"]) {
  return [
    "Return exactly one minified JSON object on one line: no Markdown, comments, explanations, or extra properties.",
    "Use this top-level shape only: {\"version\":2,\"slideId\":\"...\",\"background\":{\"color\":\"#RRGGBB\",\"prompt\":\"...\"},\"elements\":[...]}",
    "The background prompt must be text-free and at most 240 characters.",
    "Return exactly 4–8 elements: one title text, one thesis text, 0–2 shapes, and one diagram when the slide is process-like.",
    "Required fields: text={type,id,textRef,role,x,y,w,h,fontSize,color}; shape={type,id,shape,x,y,w,h,fill,stroke}; diagram={type,id,x,y,w,h,template,nodeRefs}.",
    composition === "process"
      ? "Use one flow, cycle, or hierarchy diagram with only supplied label:* nodeRefs."
      : "Use supplied label:* nodeRefs only if you add a diagram; never invent a textRef.",
    "Keep the whole JSON below 8,000 characters.",
    "Title must be at least 40px; thesis at least 30px, with enough height for wrapping. Use 48px only when the locked title fits on one line. For a long or two-line title use x=64,y=32,w=1152,h=120,fontSize=40; use the thesis at x=64,y=165,w=1152,h=145,fontSize>=30. Keep title, thesis, diagram and semantic objects in separate non-overlapping regions.",
    "Use safe regions: title fully inside x=64..1216,y=32..152; thesis fully inside x=64..1216,y=165..320; visual/diagram fully inside y=350..680. For a cycle diagram, reserve y=340..680 with at least 320px height; do not add standalone semantic shapes that overlap it.",
    "Design one dominant subject-specific composition tied to the concept (for example an orbital system or radiating energy field). Never use three or more equal rectangles, white cards, a card row, dashboard panels, or generic UI geometry.",
  ].join(" ");
}

/**
 * Extracts an editable scene plan from the actual concept image. The concept
 * is a visual reference only: all text is addressed by `textRef` and comes
 * from the content lock during compilation.
 */
export async function analyzeScene(provider: Provider, input: {
  lock: SlideContentLock;
  style: DeckStyleSpec;
  conceptPrompt: string;
  conceptImage: Buffer;
  comment?: string;
  /** The sole explicit repair attempt; its diagnostics are visible to the model. */
  repairDiagnostics?: string[];
  costBudget?: AiScenePrototypeBudget;
}): Promise<AiSceneSpec> {
  const { lock, style, conceptPrompt, conceptImage, comment, repairDiagnostics } = input;
  if (provider !== "aitunnel") throw new Error("ai_scene_multimodal_provider_unavailable");
  const client = createAitunnelClient();
  const budget = currentAitunnelProjectBudget();
  if (!budget) throw new Error("ai_scene_budget_context_missing");
  const allowedText = lock.text.map((item) => `${item.key}=${JSON.stringify(item.text)}`).join("; ");
  const prompt = [
      `Slide id: ${lock.slideId}`,
      `Content form: ${lock.composition}`,
      `Allowed visible text: ${allowedText}`,
      `Deck art direction: ${style.generationPrompt}`,
      `Concept reference: ${conceptPrompt}`,
      comment ? `Design feedback: ${comment}` : "",
      repairDiagnostics?.length ? `Repair this exact rejected scene; preserve its subject-specific composition and all content-lock references. Fix only these diagnostics: ${repairDiagnostics.join(" | ")}` : "",
      "Keep all boxes inside 1280×720. Use a clearly readable title and thesis; do not make a card grid. The editable scene must preserve one subject-specific composition from the concept, rather than substituting it with cards.",
  ].filter(Boolean).join("\n");
  const visionReference = await prepareVisionReference(conceptImage);
  const messages = [
    {
      role: "system" as const,
      content: [
        "You are a multimodal slide scene analyst. Inspect the attached concept image and return an editable 1280x720 scene.",
        "Preserve hierarchy and composition but never copy raster text. Text objects must use only supplied textRef values.",
        "Never output a template, app UI, or card grid.",
        compactSceneAnalysisContract(lock.composition),
      ].join(" "),
    },
    {
      role: "user" as const,
      content: [
        { type: "text" as const, text: `${prompt}\n${compactSceneAnalysisContract(lock.composition)}` },
        { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${visionReference.toString("base64")}`, detail: "low" as const } },
      ],
    },
  ];
  // The reservation deliberately excludes base64 bytes: they are transport
  // encoding, not model text. Actual provider usage settles the budget and
  // blocks the run before another paid stage can start on an overrun.
  const budgetRequest = { model: "gpt-5.6-luna", prompt, conceptImageBytes: visionReference.length };
  const stage: "scene_analysis" | "scene_repair" = repairDiagnostics?.length ? "scene_repair" : "scene_analysis";
  const reservationKey = `${stage}-${lock.slideId}-${Date.now()}`;
  const prototypeReserved = input.costBudget?.reserve(reservationKey, stage);
  if (prototypeReserved && prototypeReserved.status !== "reserved") throw new Error(prototypeReserved.status);
  const reserved = budget.reserve(reservationKey, stage, budgetRequest);
  if (reserved.status !== "reserved") throw new Error(reserved.status);
  const request = {
    model: "gpt-5.6-luna",
    messages,
    response_format: { type: "json_object" as const },
    max_tokens: Math.min(reserved.maxOutputTokens, SCENE_ANALYSIS_MAX_OUTPUT_TOKENS),
    temperature: 0.2,
    // A scene is a compact JSON plan, not a problem that benefits from a
    // long hidden deliberation.  This both leaves room for the actual scene
    // response and keeps the bounded prototype price predictable.
    reasoning_effort: "minimal" as const,
  };
  const startedAt = new Date();
  try {
    const { data: response, response: transport } = await client.chat.completions.create(request).withResponse();
    const usage = normalizeOpenAIUsage(response.usage);
    const reportedCostRub = aitunnelReportedCostRub(response, transport.headers);
    const settled = usage?.inputTokens !== undefined && usage?.outputTokens !== undefined
      ? budget.settle(reservationKey, usage)
      : budget.settleReportedCost(reservationKey, reportedCostRub || "");
    if (settled.status !== "settled") throw new Error(settled.status);
    const prototypeSettled = input.costBudget?.settle(reservationKey, reportedCostRub || settled.actualCostRub);
    if (prototypeSettled && prototypeSettled.status !== "settled") throw new Error(prototypeSettled.status);
    await recordAiUsage({
      provider: "aitunnel", model: "gpt-5.6-luna", operation: stage === "scene_repair" ? "scene_repair_vision" : "scene_analysis_vision", schemaName: "studydeck_ai_scene_analysis",
      providerRequestId: response.id, usage, startedAt, stage,
    });
    const choice = response.choices[0];
    if (choice?.finish_reason === "length") throw new Error("ai_scene_analysis_truncated_response");
    const raw = choice?.message.content;
    if (!raw) throw new Error("ai_scene_analysis_empty_response");
    const normalized = normalizeAiSceneSpec(parseJson(raw), lock);
    try {
      return aiSceneSpecSchema.parse(normalized);
    } catch (error) {
      // Keep just the malformed scene fields in the local failure artifact;
      // the next bounded attempt can then correct a provider dialect without
      // ever persisting the image or prompt payload.
      throw new Error(`ai_scene_contract_invalid:${sceneContractDiagnostic(normalized)}`, { cause: error });
    }
  } catch (error) {
    await recordAiUsage({ provider: "aitunnel", model: "gpt-5.6-luna", operation: stage === "scene_repair" ? "scene_repair_vision" : "scene_analysis_vision", schemaName: "studydeck_ai_scene_analysis", startedAt, stage, error });
    throw error;
  }
}

/** A compact, low-detail visual reference keeps the AITUNNEL vision request bounded. */
export async function prepareVisionReference(conceptImage: Buffer) {
  return sharp(conceptImage, { failOn: "none" })
    .rotate()
    .resize(640, 360, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 62, chromaSubsampling: "4:2:0" })
    .toBuffer();
}

export function parseJson(value: string) {
  const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text) as unknown;
}

/**
 * AI owns every visual choice (element type, geometry, colors and textRef).
 * This only supplies stable identifiers and contract-required structural
 * defaults when a provider omits them; it never synthesizes a layout or
 * replaces the model's visual scene.
 */
export function normalizeAiSceneSpec(value: unknown, lock: Pick<SlideContentLock, "slideId" | "composition" | "text">) {
  if (!isRecord(value)) return value;
  const scene: Record<string, unknown> = { ...value };
  if (scene.version === undefined) scene.version = 2;
  if (scene.slideId === undefined) scene.slideId = lock.slideId;
  if (isRecord(scene.background)) {
    const background = { ...scene.background };
    const color = normalizeSceneColor(background.color);
    if (color) background.color = color.hex;
    scene.background = background;
  }
  if (Array.isArray(scene.elements)) {
    const labelRefs = lock.text.filter((item) => item.key.startsWith("label:")).map((item) => item.key);
    scene.elements = scene.elements.map((candidate, index) => normalizeSceneElement(candidate, index, lock.composition, labelRefs, lock.text));
  }
  return scene;
}

function normalizeSceneElement(
  value: unknown,
  index: number,
  composition: SlideContentLock["composition"],
  labelRefs: string[],
  lockedText: SlideContentLock["text"],
) {
  if (!isRecord(value) || typeof value.type !== "string") return value;
  const element: Record<string, unknown> = { ...value };
  if (element.id === undefined) element.id = `ai-scene-${element.type}-${index + 1}`;
  if (element.type === "text" && element.role === undefined) {
    // Some multimodal responses echo the visible locked string as `text`
    // despite being asked for a textRef. Convert it only when it is an exact
    // content-lock match; unrecognised raster/model text remains invalid.
    if ((element.textRef === undefined || typeof element.textRef === "string") && typeof (element.textRef ?? element.text) === "string") {
      const suppliedText = typeof element.textRef === "string" ? element.textRef : element.text;
      const match = lockedText.find((item) => item.text === suppliedText);
      if (match) element.textRef = match.key;
    }
    const textRef = typeof element.textRef === "string" ? element.textRef : "";
    element.role = textRef === "title" ? "title" : textRef === "thesis" ? "thesis" : textRef.startsWith("label:") ? "label" : "caption";
  }
  for (const field of ["x", "y", "w", "h", "fontSize", "zIndex", "opacity"] as const) {
    if (typeof element[field] === "string" && /^\d+(?:\.\d+)?$/.test(element[field])) element[field] = Number(element[field]);
  }
  if (element.type === "shape" && element.stroke === undefined && typeof element.fill === "string") {
    element.stroke = element.fill;
  }
  if (element.type === "text") {
    const color = normalizeSceneColor(element.color);
    if (color) element.color = color.hex;
  }
  if (element.type === "shape") {
    const fill = normalizeSceneColor(element.fill);
    const stroke = normalizeSceneColor(element.stroke);
    if (fill) {
      element.fill = fill.hex;
      // rgba() is common in a scene description. The canvas contract keeps
      // alpha separately, so retain the provider's visual intent instead of
      // rejecting an otherwise valid freeform composition.
      if (fill.alpha !== undefined && element.opacity === undefined) element.opacity = fill.alpha;
    }
    if (stroke) element.stroke = stroke.hex;
  }
  // Keep common, visually equivalent provider vocabulary inside the shared
  // editable-canvas contract. This changes no coordinates or visual intent.
  if (element.type === "shape" && element.shape === "circle") element.shape = "ellipse";
  if (element.type === "diagram") {
    if (element.template !== "flow" && element.template !== "cycle" && element.template !== "hierarchy") {
      element.template = composition === "process" ? "flow" : "cycle";
    }
    if (!Array.isArray(element.nodeRefs) || element.nodeRefs.length < 2) element.nodeRefs = labelRefs.slice(0, 3);
  }
  return element;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeSceneColor(value: unknown): { hex: string; alpha?: number } | undefined {
  if (typeof value !== "string") return undefined;
  const color = value.trim();
  if (color.toLowerCase() === "transparent" || color.toLowerCase() === "none") return { hex: "#000000", alpha: 0 };
  const named = { white: "#FFFFFF", black: "#000000", navy: "#000080", blue: "#0000FF", gold: "#FFD700", yellow: "#FFFF00" } as const;
  const namedColor = named[color.toLowerCase() as keyof typeof named];
  if (namedColor) return { hex: namedColor };
  const shortHex = color.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) return { hex: `#${shortHex[1]!.split("").map((part) => part + part).join("").toUpperCase()}` };
  const hex = color.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) return { hex: `#${hex[1]!.toUpperCase()}`, ...(hex[2] ? { alpha: Math.round((parseInt(hex[2], 16) / 255) * 1000) / 1000 } : {}) };
  const rgb = color.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)/i);
  if (!rgb) {
    // CSS gradients cannot be represented by a single editable shape fill.
    // Preserve their leading authored stop as the safe visual approximation
    // rather than silently replacing the entire AI composition with a
    // template. The complete gradient remains available in the raster layer.
    const embeddedHex = color.match(/#([0-9a-f]{6}|[0-9a-f]{3})([0-9a-f]{2})?/i);
    return embeddedHex ? normalizeSceneColor(`#${embeddedHex[1]}${embeddedHex[2] || ""}`) : undefined;
  }
  const channels = rgb.slice(1, 4).map(Number);
  if (channels.some((channel) => channel < 0 || channel > 255)) return undefined;
  const alpha = rgb[4] === undefined ? undefined : Number(rgb[4]);
  return {
    hex: `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`,
    ...(alpha === undefined ? {} : { alpha }),
  };
}

function sceneContractDiagnostic(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.elements)) return "scene_not_an_object";
  const preview = value.elements.map((element, index) => {
    if (!isRecord(element)) return `element_${index + 1}=not_an_object`;
    const fields = ["type", "textRef", "fill", "stroke", "color"]
      .filter((key) => element[key] !== undefined)
      .map((key) => `${key}=${String(element[key]).replace(/[\r\n\t]/g, " ").slice(0, 80)}`)
      .join(",");
    return `element_${index + 1}{${fields}}`;
  }).join(";");
  const parsed = aiSceneSpecSchema.safeParse(value);
  if (parsed.success) return preview;
  const issues = parsed.error.issues.slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "scene"}:${issue.message.replace(/[\r\n\t]/g, " ").slice(0, 100)}`)
    .join("|");
  return `${preview};issues=${issues}`;
}
