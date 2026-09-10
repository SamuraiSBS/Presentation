import {
  deckStyleSpecSchema,
  type DeckStyleSpec,
  type SlideContentLock,
} from "@studydeck/shared";
import { createAitunnelClient, aitunnelConfig } from "../../../openai-client.js";
import { currentAitunnelProjectBudget } from "../../../aitunnel-narration-budget.js";
import { normalizeOpenAIUsage, recordAiUsage } from "../../../usage-ledger.js";
import { generateStructuredWithProvider } from "../providers/generation.js";
import type { AiScenePrototypeBudget } from "./prototype-budget.js";
import { aitunnelReportedCostRub } from "./provider-cost.js";

type Provider = "openai" | "yandex" | "aitunnel";
type Project = { id: string; title: string; prompt: string; scenario: string; level: string };

/** Calls the art director once for a deck; no coordinates or per-slide layout belongs here. */
export async function directDeckStyle(provider: Provider, project: Project, locks: readonly SlideContentLock[], costBudget?: AiScenePrototypeBudget): Promise<DeckStyleSpec> {
  const system = [
    "You are the art director for a premium Russian educational slide deck.",
    "Return only one compact JSON object, with every prose field under 220 Russian characters and generationPrompt under 480 characters.",
    "Use this exact shape and property names:",
    '{"version":1,"palette":{"background":"#112233","surface":"#223344","text":"#FFFFFF","mutedText":"#CCDDEE","accent":"#FFCC00","accentSecondary":"#33CCFF"},"atmosphere":"...","typography":{"title":"...","body":"...","hierarchy":"..."},"imageStyle":"...","diagramStyle":"...","whitespaceRule":"...","allowedEffects":["glow"],"forbiddenTechniques":["..."],"generationPrompt":"..."}',
    "All six palette colors must be #RRGGBB. allowedEffects may contain only soft_shadow, glow, transparent_overlay, grain, none.",
    "Design a coherent visual language; do not prescribe a repeated template or any slide coordinates.",
  ].join(" ");
  const prompt = [
    `Deck title: ${project.title}`,
    `Audience: ${project.level}. Scenario: ${project.scenario}.`,
    `Topic request: ${project.prompt}`,
    "Fixed slide content:",
    ...locks.map((lock) => `Slide ${lock.slideOrder}: ${lock.title}. ${lock.thesis}`),
    "Choose a subject-specific palette, atmosphere, typography and diagram language. Avoid generic SaaS cards, fake UI, dense grids, stock-photo collage, and text baked into background art.",
  ].join("\n");

  // The AI SDK path intentionally reads OPENAI_API_KEY. AITUNNEL is a separate
  // provider and must use its dedicated, documented chat-completions transport.
  if (provider === "aitunnel") {
    const config = aitunnelConfig();
    if (!config) throw new Error("ai_scene_aitunnel_configuration_missing");
    const budget = currentAitunnelProjectBudget();
    if (!budget) throw new Error("ai_scene_budget_context_missing");
    const reservationKey = `style-direction-${project.id}-${Date.now()}`;
    const prototypeReserved = costBudget?.reserve(reservationKey, "style_direction");
    if (prototypeReserved && prototypeReserved.status !== "reserved") throw new Error(prototypeReserved.status);
    const reserved = budget.reserve(reservationKey, "style_direction", { model: config.narrationModel, system, prompt });
    if (reserved.status !== "reserved") throw new Error(reserved.status);
    const startedAt = new Date();
    try {
      const { data: response, response: transport } = await createAitunnelClient().chat.completions.create({
        model: config.narrationModel,
        messages: [{ role: "system", content: system }, { role: "user", content: `${prompt}\nReturn one JSON object only.` }],
        response_format: { type: "json_object" },
        max_tokens: reserved.maxOutputTokens,
        temperature: 0.4,
      }).withResponse();
      const usage = normalizeOpenAIUsage(response.usage);
      const reportedCostRub = aitunnelReportedCostRub(response, transport.headers);
      const settled = usage?.inputTokens !== undefined && usage?.outputTokens !== undefined
        ? budget.settle(reservationKey, usage)
        : budget.settleReportedCost(reservationKey, reportedCostRub || "");
      if (settled.status !== "settled") throw new Error(settled.status);
      const prototypeSettled = costBudget?.settle(reservationKey, reportedCostRub || settled.actualCostRub);
      if (prototypeSettled && prototypeSettled.status !== "settled") throw new Error(prototypeSettled.status);
      await recordAiUsage({
        provider: "aitunnel", model: config.narrationModel, operation: "scene_style_direction", schemaName: "studydeck_ai_scene_style_direction",
        providerRequestId: response.id, usage, startedAt, stage: "style_direction",
      });
      const raw = response.choices[0]?.message.content;
      if (!raw) throw new Error("ai_scene_style_direction_empty_response");
      return deckStyleSpecSchema.parse(normalizeDeckStyleSpec(parseJson(raw)));
    } catch (error) {
      await recordAiUsage({ provider: "aitunnel", model: config.narrationModel, operation: "scene_style_direction", schemaName: "studydeck_ai_scene_style_direction", startedAt, stage: "style_direction", error });
      throw error;
    }
  }

  return generateStructuredWithProvider<DeckStyleSpec>({
    provider,
    system,
    prompt,
    schema: deckStyleSpecSchema,
    schemaName: "studydeck_ai_scene_style_direction",
    parse: (value) => deckStyleSpecSchema.parse(value),
    strict: false,
    maxAttempts: 1,
    aitunnelStage: "style_direction",
  });
}

function parseJson(value: unknown) {
  const text = String(value).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(text) as unknown;
}

/** Only trims provider prose to the persisted contract; it never supplies a template style. */
export function normalizeDeckStyleSpec(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const style = { ...(value as Record<string, unknown>) };
  style.atmosphere = truncate(style.atmosphere, 600);
  style.imageStyle = truncate(style.imageStyle, 400);
  style.diagramStyle = truncate(style.diagramStyle, 400);
  style.whitespaceRule = truncate(style.whitespaceRule, 400);
  style.generationPrompt = truncate(style.generationPrompt, 480);
  if (style.typography && typeof style.typography === "object" && !Array.isArray(style.typography)) {
    const typography = { ...(style.typography as Record<string, unknown>) };
    typography.title = truncate(typography.title, 80);
    typography.body = truncate(typography.body, 80);
    typography.hierarchy = truncate(typography.hierarchy, 400);
    style.typography = typography;
  }
  if (Array.isArray(style.forbiddenTechniques)) style.forbiddenTechniques = style.forbiddenTechniques.map((item) => truncate(item, 160));
  return style;
}

function truncate(value: unknown, maximum: number) {
  return typeof value === "string" ? value.slice(0, maximum) : value;
}
