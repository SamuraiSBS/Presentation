import crypto from "node:crypto";

export type DefensePlanBuilderInput = {
  config: {
    defenseType: "hackathon" | "diploma";
    complianceMode: "strict" | "adaptive";
    targetSlideCount: number;
    targetDurationSeconds: number;
    authorProfile: Record<string, unknown>;
    standardPresetVersion?: "hackathon-v1" | "diploma-v1" | null;
  };
  presetSlides: Array<{ key: string; title: string; purpose: string }>;
  requirements: Array<{
    id: string;
    text: string;
    priority: "required" | "recommended" | "preference";
    state: "active" | "ignored";
    origin: "builtin" | "source" | "user";
    rule?: Record<string, unknown> | null;
  }>;
  facts: Array<{ id: string; statement: string; active?: boolean; evidenceCount?: number }>;
  assets: Array<{ id: string; role?: string | null; label?: string; metadata?: Record<string, unknown> | null }>;
  conflicts: Array<{ id: string; summary: string; kind: string; state: "unresolved" | "resolved" | "ignored" }>;
};

export type DefensePlanOutput = {
  version: 1;
  defenseType: "hackathon" | "diploma";
  complianceMode: "strict" | "adaptive";
  presetVersion: "hackathon-v1" | "diploma-v1" | null;
  status: "draft";
  slides: Array<{
    id: string;
    order: number;
    title: string;
    purpose: string;
    timingSeconds: number;
    requirementIds: string[];
    factIds: string[];
    assetSourceIds: string[];
    placeholders: Array<{
      id: string;
      requirementId?: string;
      kind: "text" | "identity" | "metric" | "screenshot" | "diagram" | "conflict";
      label: string;
      resolved: false;
      severity: "warning" | "error";
    }>;
    visualStrategy: string;
    adaptiveChangeReason?: string;
    origin: "builtin" | "source" | "user";
    presetSlideKey?: string;
  }>;
  totalTimingSeconds: number;
  approvedAt: null;
};

export function buildDefensePlan(input: DefensePlanBuilderInput): DefensePlanOutput {
  const activeRequirements = input.requirements.filter((item) => item.state === "active");
  const confirmedFacts = input.facts.filter((item) => item.active !== false && (item.evidenceCount ?? 1) > 0);
  const targetCount = clamp(Math.round(input.config.targetSlideCount), 4, 20);
  const base: Array<{
    key: string;
    title: string;
    purpose: string;
    origin: "builtin" | "source" | "user";
  }> = input.presetSlides.slice(0, targetCount).map((item) => ({ ...item, origin: "builtin" }));
  while (base.length < targetCount) {
    const requirement = activeRequirements.find((item) => !base.some((slide) => normalize(slide.title).includes(normalize(item.text).slice(0, 18))));
    const order = base.length + 1;
    base.push({
      key: `custom-${order}`,
      title: requirement ? conciseTitle(requirement.text) : `Раздел проекта ${order}`,
      purpose: requirement ? `Выполнить требование: ${requirement.text}` : "Раскрыть подтверждённую часть проекта",
      origin: requirement?.origin === "user" ? "user" : "source",
    });
  }

  const timing = allocateTiming(input.config.targetDurationSeconds, base.length);
  const slides: DefensePlanOutput["slides"] = base.map((item, index) => ({
    id: stableId(`plan:${input.config.defenseType}:${item.key}:${index + 1}`),
    order: index + 1,
    title: item.title,
    purpose: item.purpose,
    timingSeconds: timing[index],
    requirementIds: [],
    factIds: [],
    assetSourceIds: [],
    placeholders: [],
    visualStrategy: visualStrategy(item.title, item.purpose),
    origin: item.origin,
    presetSlideKey: item.origin === "builtin" ? item.key : undefined,
  }));

  // Required rules always get their literal placement first. Adaptive mode may
  // reorganize only the remaining optional portion of the template.
  const requiredRequirements = activeRequirements.filter((item) => item.priority === "required");
  const optionalRequirements = activeRequirements.filter((item) => item.priority !== "required");
  const reservedSlideIds = new Set(requiredRequirements.map((requirement) => targetSlideForRequirement(slides, requirement, true).id));

  for (const requirement of requiredRequirements) {
    applyRequirementToSlide(targetSlideForRequirement(slides, requirement, true), requirement, input);
  }
  for (const requirement of optionalRequirements) {
    const target = input.config.complianceMode === "adaptive"
      ? targetSlideForAdaptiveRequirement(slides, requirement, reservedSlideIds)
      : targetSlideForRequirement(slides, requirement, true);
    applyRequirementToSlide(target, requirement, input);
  }

  for (const fact of confirmedFacts) {
    targetSlideByText(slides, fact.statement).factIds.push(fact.id);
  }
  for (const asset of input.assets) {
    targetSlideForAsset(slides, asset.role || "").assetSourceIds.push(asset.id);
  }

  addIdentityPlaceholders(slides[0], input.config);
  for (const conflict of input.conflicts.filter((item) => item.state === "unresolved")) {
    const target = targetSlideByText(slides, conflict.summary);
    target.placeholders.push({
      id: stableId(`conflict:${conflict.id}`),
      kind: "conflict",
      label: `Разрешите противоречие: ${conflict.summary}`,
      resolved: false,
      severity: "error",
    });
  }

  slides.forEach((slide) => {
    slide.requirementIds = unique(slide.requirementIds);
    slide.factIds = unique(slide.factIds);
    slide.assetSourceIds = unique(slide.assetSourceIds);
    slide.placeholders = dedupePlaceholders(slide.placeholders);
  });

  return {
    version: 1,
    defenseType: input.config.defenseType,
    complianceMode: input.config.complianceMode,
    presetVersion: input.config.standardPresetVersion || `${input.config.defenseType}-v1`,
    status: "draft",
    slides,
    totalTimingSeconds: slides.reduce((sum, slide) => sum + slide.timingSeconds, 0),
    approvedAt: null,
  };
}

export function allocateTiming(targetSeconds: number, slideCount: number) {
  const count = clamp(Math.round(slideCount), 1, 20);
  const total = clamp(Math.max(Math.round(targetSeconds), count * 20), count * 20, 900);
  const weights = Array.from({ length: count }, (_, index) => index === 0 || index === count - 1 ? 0.78 : 1);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => total * weight / weightTotal);
  const values = raw.map(Math.floor);
  let remainder = total - values.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; remainder > 0; index = (index + 1) % order.length) {
    values[order[index].index] += 1;
    remainder -= 1;
  }
  return values;
}

function applyRequirementToSlide(
  target: DefensePlanOutput["slides"][number],
  requirement: DefensePlanBuilderInput["requirements"][number],
  input: DefensePlanBuilderInput,
) {
  target.requirementIds.push(requirement.id);
  const rule = requirement.rule || {};
  const assetRole = clean(String(rule.assetRole || rule.role || ""));
  const requiredField = clean(String(rule.field || ""));
  if (assetRole && !input.assets.some((asset) => asset.role === assetRole)) {
    target.placeholders.push(makePlaceholder(requirement, assetRole === "screenshot" ? "screenshot" : "text", `Добавьте материал: ${assetRole}`));
  }
  if (requiredField && !clean(String(input.config.authorProfile[requiredField] || ""))) {
    target.placeholders.push(makePlaceholder(requirement, "identity", `Заполните данные автора: ${requiredField}`));
  }
}

function targetSlideForRequirement(
  slides: DefensePlanOutput["slides"],
  requirement: DefensePlanBuilderInput["requirements"][number],
  honorPosition: boolean,
) {
  const rule = requirement.rule || {};
  if (honorPosition) {
    const position = clean(String(rule.position || "")).toLowerCase();
    if (position === "first") return slides[0];
    if (position === "last") return slides[slides.length - 1];
    const requestedOrder = Number(rule.order ?? rule.slideOrder ?? (typeof rule.position === "number" ? rule.position : 0));
    if (Number.isInteger(requestedOrder) && requestedOrder >= 1 && requestedOrder <= slides.length) return slides[requestedOrder - 1];
  }
  return targetSlideByText(slides, requirement.text);
}

function targetSlideByText(slides: DefensePlanOutput["slides"], text: string) {
  const match = bestTextMatch(slides, text);
  return match.score ? match.slide : slides[Math.min(1, slides.length - 1)];
}

function bestTextMatch(slides: DefensePlanOutput["slides"], text: string) {
  const tokens = meaningfulTokens(text);
  const scored = slides.map((slide) => ({
    slide,
    score: [...meaningfulTokens(`${slide.title} ${slide.purpose}`)].filter((token) => tokens.has(token)).length,
  })).sort((a, b) => b.score - a.score || a.slide.order - b.slide.order);
  return scored[0] || { slide: slides[0], score: 0 };
}

function targetSlideForAdaptiveRequirement(
  slides: DefensePlanOutput["slides"],
  requirement: DefensePlanBuilderInput["requirements"][number],
  reservedSlideIds: Set<string>,
) {
  const matching = bestTextMatch(slides, requirement.text);
  if (matching.score > 0 && !reservedSlideIds.has(matching.slide.id)) return matching.slide;

  const replacement = slides
    .filter((slide) => slide.origin === "builtin" && !reservedSlideIds.has(slide.id) && slide.order !== 1 && slide.order !== slides.length)
    .sort((left, right) => left.requirementIds.length - right.requirementIds.length || left.order - right.order)[0];
  if (!replacement) return targetSlideForRequirement(slides, requirement, false);

  const previousTitle = replacement.title;
  replacement.title = conciseTitle(requirement.text);
  replacement.purpose = `Адаптировано для необязательного требования: ${requirement.text}`;
  replacement.origin = requirement.origin === "user" ? "user" : "source";
  replacement.presetSlideKey = undefined;
  replacement.visualStrategy = visualStrategy(replacement.title, replacement.purpose);
  replacement.adaptiveChangeReason = `Необязательное требование заменило шаблонный раздел «${previousTitle}» без изменения обязательных ограничений или подтверждённых фактов.`;
  return replacement;
}

function targetSlideForAsset(slides: DefensePlanOutput["slides"], role: string) {
  if (role === "logo") return slides[0];
  if (role === "screenshot") {
    return slides.find((slide) => /демонстрац|интерфейс|реализац|функц/iu.test(`${slide.title} ${slide.purpose}`)) || slides[Math.floor(slides.length / 2)];
  }
  if (role === "style_reference") return slides[0];
  return slides[Math.min(1, slides.length - 1)];
}

function addIdentityPlaceholders(slide: DefensePlanOutput["slides"][number], config: DefensePlanBuilderInput["config"]) {
  const fields = config.defenseType === "diploma"
    ? [["fullName", "ФИО"], ["institution", "учебное заведение"], ["supervisor", "руководитель"]]
    : [["teamName", "название команды"], ["eventName", "название мероприятия"]];
  for (const [field, label] of fields) {
    if (clean(String(config.authorProfile[field] || ""))) continue;
    slide.placeholders.push({
      id: stableId(`identity:${field}`),
      kind: "identity",
      label: `Укажите ${label}`,
      resolved: false,
      severity: "warning",
    });
  }
}

function makePlaceholder(
  requirement: DefensePlanBuilderInput["requirements"][number],
  kind: DefensePlanOutput["slides"][number]["placeholders"][number]["kind"],
  label: string,
) {
  return {
    id: stableId(`requirement:${requirement.id}:${kind}`),
    requirementId: requirement.id,
    kind,
    label,
    resolved: false as const,
    severity: requirement.priority === "required" ? "error" as const : "warning" as const,
  };
}

function visualStrategy(title: string, purpose: string) {
  const value = `${title} ${purpose}`;
  if (/демонстрац|интерфейс|реализац/iu.test(value)) return "project_screenshot";
  if (/архитектур|принцип работы|процесс/iu.test(value)) return "evidence_diagram";
  if (/результат|метрик|тестирован/iu.test(value)) return "confirmed_metrics";
  if (/название|титульн|команд/iu.test(value)) return "identity_and_logo";
  return "grounded_text_and_user_asset";
}

function meaningfulTokens(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token.length >= 4));
}

function conciseTitle(value: string) {
  const words = clean(value).split(/\s+/).slice(0, 8).join(" ");
  return words.length > 72 ? `${words.slice(0, 69).trim()}…` : words;
}

function normalize(value: string) {
  return clean(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");
}

function clean(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stableId(value: string) {
  return `def_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function dedupePlaceholders<T extends { id: string }>(items: T[]) {
  const map = new Map<string, T>();
  items.forEach((item) => map.set(item.id, item));
  return [...map.values()];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
