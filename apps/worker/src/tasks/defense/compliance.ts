import crypto from "node:crypto";
import { generateText } from "ai";
import { z } from "zod";
import {
  complianceReportDocumentSchema,
  presentationSchema,
  type ComplianceItem,
  type ComplianceReportDocument,
  type DefenseAsset,
  type DefensePlan,
  type ProjectConflict,
  type ProjectFact,
  type ProjectRequirement,
} from "@studydeck/shared";
import { requestYandexText } from "../presentation/narration/processing.js";
import { requestOpenAIStructuredWithSdk } from "../presentation/providers/generation.js";
import { selectAiProviders } from "../presentation/providers/provider-selection.js";

type Presentation = ReturnType<typeof presentationSchema.parse>;

export type DefenseComplianceInput = {
  reportId: string;
  workspaceId: string;
  presentationRevision: number;
  analysisRevision: number;
  planRevision: number;
  presentation: Presentation;
  plan: DefensePlan;
  authorProfile: Record<string, unknown>;
  requirements: ProjectRequirement[];
  facts: ProjectFact[];
  conflicts: ProjectConflict[];
  assets: DefenseAsset[];
  previousReport?: ComplianceReportDocument | null;
};

const semanticResultSchema = z.object({
  items: z.array(z.object({
    requirementId: z.string().min(1),
    result: z.enum(["satisfied", "partial", "unsatisfied", "needs_review"]),
    reason: z.string().trim().min(1).max(2_000),
    evidence: z.array(z.object({
      slideOrder: z.number().int().min(1).max(20),
      matchedTextFragment: z.string().trim().min(1).max(1_000),
    }).strict()).max(20).default([]),
  }).strict()).max(500),
}).strict();

type SemanticResult = z.infer<typeof semanticResultSchema>;

export async function checkDefenseCompliance(
  input: DefenseComplianceInput,
  dependencies: {
    semantic?: (prompt: string) => Promise<unknown>;
    providers?: Array<"openai" | "yandex">;
  } = {},
) {
  let report = buildDeterministicComplianceReport(input);
  const semanticRequirements = input.requirements.filter((requirement) =>
    requirement.state === "active"
      && (!requirement.rule || (requirement.rule.kind === "content_presence" && !requirement.rule.phrase)),
  );
  if (!semanticRequirements.length) return report;

  let raw: unknown;
  try {
    if (dependencies.semantic) raw = await dependencies.semantic(buildSemanticPrompt(input, semanticRequirements));
    else {
      for (const provider of dependencies.providers || selectAiProviders()) {
        if (provider === "openai") {
          raw = await requestOpenAIStructuredWithSdk({
            generate: generateText,
            system: SEMANTIC_SYSTEM,
            prompt: buildSemanticPrompt(input, semanticRequirements),
            schema: semanticResultSchema,
            schemaName: "studydeck_defense_compliance",
            temperature: 0.05,
          });
        } else {
          const apiKey = process.env.YANDEX_API_KEY?.trim();
          if (!apiKey) continue;
          raw = JSON.parse(await requestYandexText(apiKey, SEMANTIC_SYSTEM, buildSemanticPrompt(input, semanticRequirements), { jsonObject: true, temperature: 0.05, maxTokens: 6000 }));
        }
        break;
      }
    }
    if (raw === undefined) return complianceReportDocumentSchema.parse({ ...report, semanticStatus: "not_run" });
    const semantic = semanticResultSchema.parse(raw);
    report = mergeSemanticResults(report, semantic, input.presentation);
    return complianceReportDocumentSchema.parse({ ...report, semanticStatus: "complete" });
  } catch {
    return complianceReportDocumentSchema.parse({
      ...report,
      semanticStatus: "failed",
      warnings: [...report.warnings, "Семантическая проверка недоступна; детерминированные результаты сохранены, остальные пункты требуют ручной проверки."],
    });
  }
}

export function buildDeterministicComplianceReport(input: DefenseComplianceInput): ComplianceReportDocument {
  const presentation = presentationSchema.parse(input.presentation);
  const items = input.requirements.map((requirement) => evaluateRequirement(requirement, input, presentation));
  const placeholders = uniqueById([
    ...input.plan.slides.flatMap((slide) => slide.placeholders),
    ...presentation.slides.flatMap((slide) => slide.placeholders),
  ]);
  const timingOverloads = presentation.slides.flatMap((slide) => {
    const estimatedSeconds = estimateSpeechSeconds(slide.speakerNotes);
    return estimatedSeconds > slide.timingSeconds
      ? [{
          slideId: slide.id,
          slideOrder: slide.order,
          allocatedSeconds: slide.timingSeconds,
          estimatedSeconds,
          overflowSeconds: estimatedSeconds - slide.timingSeconds,
        }]
      : [];
  });
  const warnings: string[] = [];
  if (placeholders.some((placeholder) => !placeholder.resolved)) warnings.push("В презентации остались незаполненные данные или материалы.");
  if (input.conflicts.some((conflict) => conflict.state === "unresolved")) warnings.push("В анализе остались неразрешённые противоречия.");
  if (timingOverloads.length) warnings.push("Часть заметок не укладывается в выделенный тайминг.");

  const report: ComplianceReportDocument = {
    schemaVersion: 1,
    reportId: input.reportId,
    workspaceId: input.workspaceId,
    presentationRevision: input.presentationRevision,
    analysisRevision: input.analysisRevision,
    planRevision: input.planRevision,
    checkedAt: new Date().toISOString(),
    semanticStatus: "not_run",
    counts: summarizeItems(items),
    items,
    placeholders,
    conflicts: input.conflicts.map((conflict) => ({
      conflictId: conflict.id,
      kind: conflict.kind,
      state: conflict.state,
      summary: conflict.summary,
    })),
    factProvenance: input.facts.filter((fact) => fact.state === "active").map((fact) => ({
      factId: fact.id,
      statement: fact.statement,
      evidence: fact.evidence,
    })),
    imageProvenance: buildImageProvenance(input, presentation),
    timingOverloads,
    diff: buildReportDiff(input.previousReport || null, items, placeholders),
    warnings,
  };
  return complianceReportDocumentSchema.parse(report);
}

function evaluateRequirement(requirement: ProjectRequirement, input: DefenseComplianceInput, presentation: Presentation): ComplianceItem {
  const base = {
    id: stableId(`check:${requirement.id}`),
    checkKey: requirement.key || `requirement:${requirement.id}`,
    requirementId: requirement.id,
    priority: requirement.priority,
    evidence: [] as ComplianceItem["evidence"],
  };
  if (requirement.state === "ignored") {
    return { ...base, result: "ignored", deterministicResult: "ignored", reason: "Требование исключено пользователем." };
  }
  const rule = requirement.rule;
  if (!rule) return { ...base, result: "needs_review", semanticResult: "needs_review", reason: "Нужна семантическая проверка содержания." };

  if (rule.kind === "slide_count") {
    const count = presentation.slides.length;
    const passed = (rule.exact === undefined || count === rule.exact)
      && (rule.min === undefined || count >= rule.min)
      && (rule.max === undefined || count <= rule.max);
    return deterministicItem(base, passed, `В презентации ${count} слайдов.`, [{ slideOrder: 1, requirementIds: [requirement.id], factIds: [] }]);
  }

  if (rule.kind === "slide_position") {
    const order = rule.position === "first" ? 1 : rule.position === "last" ? presentation.slides.length : rule.order || 1;
    const slide = presentation.slides.find((item) => item.order === order);
    const planSlide = input.plan.slides.find((item) => item.order === order);
    const renderedText = slide ? normalize(`${slide.title} ${slide.thesis} ${slide.bullets.join(" ")} ${slide.speakerNotes}`) : "";
    const passed = Boolean(
      slide
      && planSlide?.requirementIds.includes(requirement.id)
      && renderedText.includes(normalize(requirement.text)),
    );
    return deterministicItem(base, passed, passed ? `Требование закреплено за слайдом ${order}.` : `Слайд ${order} не покрывает требование.`, slide ? [{ slideId: slide.id, slideOrder: order, requirementIds: [requirement.id], factIds: [] }] : []);
  }

  if (rule.kind === "timing") {
    const value = rule.scope === "total"
      ? presentation.slides.reduce((sum, slide) => sum + slide.timingSeconds, 0)
      : presentation.slides.find((slide) => slide.order === rule.slideOrder)?.timingSeconds || 0;
    const passed = (rule.exactSeconds === undefined || value === rule.exactSeconds)
      && (rule.minSeconds === undefined || value >= rule.minSeconds)
      && (rule.maxSeconds === undefined || value <= rule.maxSeconds);
    const slide = rule.scope === "slide" ? presentation.slides.find((item) => item.order === rule.slideOrder) : undefined;
    return deterministicItem(base, passed, `Проверенный тайминг: ${value} сек.`, slide ? [{ slideId: slide.id, slideOrder: slide.order, requirementIds: [requirement.id], factIds: [] }] : [{ slideOrder: 1, requirementIds: [requirement.id], factIds: [] }]);
  }

  if (rule.kind === "author_field") {
    const passed = Boolean(clean(String(input.authorProfile[rule.field] || "")));
    return deterministicItem(base, passed, passed ? "Поле автора заполнено." : `Не заполнено поле автора: ${rule.field}.`);
  }

  if (rule.kind === "asset_count") {
    const candidateSlides = rule.slideOrder
      ? presentation.slides.filter((slide) => slide.order === rule.slideOrder)
      : presentation.slides;
    const renderedSourceIds = new Set(candidateSlides.flatMap((slide) => slide.visual.image?.sourceId ? [slide.visual.image.sourceId] : []));
    const count = input.assets.filter((asset) =>
      asset.included && asset.role === rule.role && renderedSourceIds.has(asset.sourceId),
    ).length;
    return deterministicItem(base, count >= rule.minCount, `В презентации использовано материалов роли ${rule.role}: ${count} из ${rule.minCount}.`);
  }

  if (rule.kind === "palette") {
    const theme = presentation.presentationTheme;
    const values = theme ? Object.values(theme.colors).map((color) => color.toUpperCase()) : [];
    const passed = values.includes(rule.color.toUpperCase());
    return deterministicItem(base, passed, passed ? `Цвет ${rule.color} присутствует в теме.` : `Цвет ${rule.color} не найден в теме.`);
  }

  if (rule.kind === "theme") {
    const theme = presentation.presentationTheme;
    const tone = theme?.mood === "dark" ? "dark" : theme ? "light" : undefined;
    const passed = Boolean(theme)
      && (!rule.themeId || theme?.themeId === rule.themeId)
      && (!rule.tone || rule.tone === "mixed" || tone === rule.tone);
    return deterministicItem(base, passed, passed ? "Тема презентации соответствует правилу." : "Тема презентации не соответствует правилу.");
  }

  if (rule.kind === "speaker_notes") {
    const slides = rule.slideOrder ? presentation.slides.filter((slide) => slide.order === rule.slideOrder) : presentation.slides;
    const passed = slides.length > 0 && slides.every((slide) => clean(slide.speakerNotes).length >= 20);
    return deterministicItem(base, passed, passed ? "Текст выступления присутствует." : "Для части слайдов отсутствует полноценный текст выступления.", slides.slice(0, 5).map((slide) => ({ slideId: slide.id, slideOrder: slide.order, requirementIds: [requirement.id], factIds: [] })));
  }

  if (rule.kind === "content_presence") {
    if (!rule.phrase) return { ...base, result: "needs_review", semanticResult: "needs_review", reason: "Формулировку нужно проверить по смыслу." };
    const candidates = presentation.slides.filter((slide) => !rule.slideOrder || slide.order === rule.slideOrder);
    const normalizedPhrase = normalize(rule.phrase);
    const matched = candidates.find((slide) => {
      const slidesText = `${slide.title} ${slide.thesis} ${slide.bullets.join(" ")}`;
      const notesText = slide.speakerNotes;
      if (rule.target === "slides") return normalize(slidesText).includes(normalizedPhrase);
      if (rule.target === "notes") return normalize(notesText).includes(normalizedPhrase);
      return normalize(`${slidesText} ${notesText}`).includes(normalizedPhrase);
    });
    return deterministicItem(base, Boolean(matched), matched ? "Обязательная формулировка найдена." : "Обязательная формулировка не найдена.", matched ? [{ slideId: matched.id, slideOrder: matched.order, matchedTextFragment: rule.phrase, requirementIds: [requirement.id], factIds: [] }] : []);
  }

  return { ...base, result: "needs_review", semanticResult: "needs_review", reason: "Требование требует ручной проверки." };
}

function deterministicItem(
  base: Pick<ComplianceItem, "id" | "checkKey" | "requirementId" | "priority" | "evidence">,
  passed: boolean,
  reason: string,
  evidence: ComplianceItem["evidence"] = [],
): ComplianceItem {
  return { ...base, evidence, result: passed ? "satisfied" : "unsatisfied", deterministicResult: passed ? "satisfied" : "unsatisfied", reason };
}

function mergeSemanticResults(report: ComplianceReportDocument, semantic: SemanticResult, presentation: Presentation) {
  const byRequirement = new Map(semantic.items.map((item) => [item.requirementId, item]));
  const items = report.items.map((item) => {
    if (!item.requirementId || item.deterministicResult) return item;
    const result = byRequirement.get(item.requirementId);
    if (!result) return item;
    const evidence = result.evidence.flatMap((entry) => {
      const slide = presentation.slides.find((candidate) => candidate.order === entry.slideOrder);
      return slide ? [{
        slideId: slide.id,
        slideOrder: slide.order,
        matchedTextFragment: entry.matchedTextFragment,
        factIds: [],
        requirementIds: [item.requirementId!],
      }] : [];
    });
    const safeResult = (result.result === "satisfied" || result.result === "partial") && !evidence.length ? "needs_review" : result.result;
    return { ...item, result: safeResult, semanticResult: safeResult, reason: result.reason, evidence };
  });
  return { ...report, items, counts: summarizeItems(items) };
}

function summarizeItems(items: ComplianceItem[]): ComplianceReportDocument["counts"] {
  const empty = () => ({ total: 0, satisfied: 0, partial: 0, unsatisfied: 0, ignored: 0, needsReview: 0 });
  const counts = { required: empty(), recommended: empty(), preference: empty() };
  for (const item of items) {
    const target = counts[item.priority];
    target.total += 1;
    if (item.result === "needs_review") target.needsReview += 1;
    else target[item.result] += 1;
  }
  return counts;
}

function buildImageProvenance(input: DefenseComplianceInput, presentation: Presentation): ComplianceReportDocument["imageProvenance"] {
  const assignedSlides = new Map<string, string[]>();
  input.plan.slides.forEach((slide) => slide.assetSourceIds.forEach((id) => assignedSlides.set(id, [...(assignedSlides.get(id) || []), slide.id])));
  const assets: ComplianceReportDocument["imageProvenance"] = input.assets
    // Uploaded assets are authoritative inputs. Web images are reported from the
    // rendered presentation below, where their original URL is still available.
    .filter((asset) => ["screenshot", "logo", "supporting_image"].includes(asset.role))
    .map((asset) => {
      const origin = asset.metadata.origin;
      const provider = origin === "repository" ? "repository" as const : origin === "archive" ? "archive" as const : origin === "web" ? "tavily" as const : "user" as const;
      return {
        sourceId: asset.sourceId,
        role: asset.role,
        provider,
        slideIds: assignedSlides.get(asset.sourceId) || [],
        evidenceRole: provider !== "tavily" && ["screenshot", "logo"].includes(asset.role),
        label: asset.label,
      };
    });
  for (const slide of presentation.slides) {
    const image = slide.visual.image;
    if (!image || image.provider !== "tavily" || !image.sourceUrl) continue;
    assets.push({
      sourceId: stableId(`tavily:${slide.id}:${image.sourceUrl}`),
      role: "web_image",
      provider: "tavily",
      sourceUrl: image.sourceUrl,
      slideIds: [slide.id],
      evidenceRole: false,
      label: image.sourceTitle || image.alt || "Интернет-изображение",
    });
  }
  return assets;
}

function buildReportDiff(previous: ComplianceReportDocument | null, items: ComplianceItem[], placeholders: ComplianceReportDocument["placeholders"]) {
  if (!previous) return { fixedRequirementIds: [], regressedRequirementIds: [], newPlaceholderIds: placeholders.filter((item) => !item.resolved).map((item) => item.id), resolvedPlaceholderIds: [] };
  const previousByRequirement = new Map(previous.items.filter((item) => item.requirementId).map((item) => [item.requirementId!, item.result]));
  const fixedRequirementIds: string[] = [];
  const regressedRequirementIds: string[] = [];
  for (const item of items) {
    if (!item.requirementId) continue;
    const before = previousByRequirement.get(item.requirementId);
    if ((before === "unsatisfied" || before === "partial" || before === "needs_review") && item.result === "satisfied") fixedRequirementIds.push(item.requirementId);
    if (before === "satisfied" && (item.result === "unsatisfied" || item.result === "partial")) regressedRequirementIds.push(item.requirementId);
  }
  const previousUnresolved = new Set(previous.placeholders.filter((item) => !item.resolved).map((item) => item.id));
  const currentUnresolved = new Set(placeholders.filter((item) => !item.resolved).map((item) => item.id));
  return {
    fixedRequirementIds,
    regressedRequirementIds,
    newPlaceholderIds: [...currentUnresolved].filter((id) => !previousUnresolved.has(id)),
    resolvedPlaceholderIds: [...previousUnresolved].filter((id) => !currentUnresolved.has(id)),
  };
}

function buildSemanticPrompt(input: DefenseComplianceInput, requirements: ProjectRequirement[]) {
  const slides = input.presentation.slides.map((slide) => ({
    id: slide.id,
    order: slide.order,
    title: slide.title,
    text: `${slide.thesis} ${slide.bullets.join(" ")}`.slice(0, 1800),
    notes: slide.speakerNotes.slice(0, 2400),
  }));
  return [
    "Сопоставь активные требования с реальным содержанием слайдов и заметок.",
    "Нельзя считать требование выполненным без точного фрагмента evidence.",
    "Не отменяй детерминированные проверки; здесь перечислены только смысловые требования.",
    `Требования: ${JSON.stringify(requirements.map((item) => ({ id: item.id, text: item.text, priority: item.priority })))}`,
    `Слайды: ${JSON.stringify(slides)}`,
  ].join("\n");
}

const SEMANTIC_SYSTEM = "Ты строгий проверяющий студенческой презентации по ТЗ. Возвращай JSON, не додумывай evidence и пиши причины по-русски.";

function estimateSpeechSeconds(value: string) {
  const words = clean(value).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 130 * 60));
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const map = new Map<string, T>();
  items.forEach((item) => map.set(item.id, item));
  return [...map.values()];
}

function stableId(value: string) {
  return `cmp_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
}

function normalize(value: string) {
  return clean(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");
}

function clean(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
