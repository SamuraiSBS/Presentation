import type { Prisma } from "@prisma/client";
import {
  defenseGroundingBundleSchema,
  defenseSourceMetadataSchema,
  presentationSchema,
  requirementRuleSchema,
  resolvePresentationTheme,
  type DefenseAsset,
  type DefenseGroundingBundle,
  type PresentationDocument,
  type Source,
} from "@studydeck/shared";

type EvidenceRow = {
  id: string;
  confirmation: string;
  sourceId: string | null;
  locator: string | null;
  excerpt: string | null;
  confirmedById: string | null;
  createdAt: Date;
};

type FactRow = {
  id: string;
  key: string | null;
  statement: string;
  value: Prisma.JsonValue | null;
  state: string;
  evidence: EvidenceRow[];
};

type RequirementRow = {
  id: string;
  key: string | null;
  text: string;
  priority: string;
  origin: string;
  state: string;
  sourceId: string | null;
  locator: string | null;
  excerpt: string | null;
  rule: Prisma.JsonValue | null;
  presetVersion: string | null;
};

type ConflictRow = {
  id: string;
  kind: string;
  summary: string;
  options: Prisma.JsonValue;
  state: string;
  resolution: Prisma.JsonValue | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
};

export type DefenseGroundingSourceRow = {
  id: string;
  label: string;
  role: string | null;
  objectKey: string | null;
  metadata: Prisma.JsonValue | null;
  included: boolean;
};

export type DefenseGroundingWorkspaceRow = {
  defenseType: string;
  complianceMode: string;
  language: string;
  targetSlideCount: number;
  targetDurationSeconds: number;
  allowWebImages: boolean;
  authorProfile: Prisma.JsonValue;
  standardPresetVersion: string;
  analysisRevision: number;
  planRevision: number;
  styleBrief: Prisma.JsonValue | null;
  plan: Prisma.JsonValue | null;
  facts: FactRow[];
  requirements: RequirementRow[];
  conflicts: ConflictRow[];
  project: { sources: DefenseGroundingSourceRow[] };
};

type DefenseGenerationProject = {
  id: string;
  title: string;
  prompt: string;
  scenario: string;
  level: string;
  mode: string;
  slideCount: number;
  workflow?: string;
  allowWebImages?: boolean;
};

export function buildDefenseGroundingBundle(workspace: DefenseGroundingWorkspaceRow): DefenseGroundingBundle {
  if (!workspace.plan) throw new Error("Defense plan has not been created");
  const assets = workspace.project.sources.flatMap(mapAsset);
  const includedSourceIds = new Set(workspace.project.sources.filter((source) => source.included).map((source) => source.id));
  const facts = workspace.facts
    .filter((fact) => fact.state === "active" && fact.evidence.length > 0)
    .map((fact) => {
      const evidence = fact.evidence
        .filter((item) => isUsableFactEvidence(item, includedSourceIds))
        .map((item) => ({
          id: item.id,
          factId: fact.id,
          confirmation: item.confirmation,
          ...(item.confirmation === "source" && item.sourceId ? { sourceId: item.sourceId } : {}),
          ...(item.locator ? { locator: item.locator } : {}),
          ...(item.excerpt ? { excerpt: item.excerpt } : {}),
          ...(item.confirmedById ? { confirmedById: item.confirmedById } : {}),
          confirmedAt: item.createdAt.toISOString(),
        }));
      return {
        id: fact.id,
        ...(fact.key ? { key: fact.key } : {}),
        statement: fact.statement,
        ...(fact.value === null ? {} : { value: fact.value }),
        state: "active" as const,
        evidence,
      };
    })
    .filter((fact) => fact.evidence.length > 0);
  const requirements = workspace.requirements
    .filter((requirement) => requirement.state === "active")
    .map((requirement) => {
      const rule = requirementRuleSchema.safeParse(requirement.rule);
      return {
        id: requirement.id,
        ...(requirement.key ? { key: requirement.key } : {}),
        text: requirement.text,
        priority: requirement.priority,
        origin: requirement.origin,
        state: "active" as const,
        ...(requirement.sourceId ? { sourceId: requirement.sourceId } : {}),
        ...(requirement.locator ? { locator: requirement.locator } : {}),
        ...(requirement.excerpt ? { excerpt: requirement.excerpt } : {}),
        ...(rule.success ? { rule: rule.data } : {}),
        ...(requirement.presetVersion ? { presetVersion: requirement.presetVersion } : {}),
      };
    });
  const resolvedConflicts = workspace.conflicts
    .filter((conflict) => conflict.state === "resolved")
    .map((conflict) => ({
      id: conflict.id,
      kind: conflict.kind,
      summary: conflict.summary,
      options: conflict.options,
      state: "resolved" as const,
      ...(conflict.resolution === null ? {} : { resolution: conflict.resolution }),
      ...(conflict.resolvedById ? { resolvedById: conflict.resolvedById } : {}),
      ...(conflict.resolvedAt ? { resolvedAt: conflict.resolvedAt.toISOString() } : {}),
    }));
  const styleBrief = workspace.styleBrief === null ? null : workspace.styleBrief;

  return defenseGroundingBundleSchema.parse({
    version: 1,
    analysisRevision: workspace.analysisRevision,
    planRevision: workspace.planRevision,
    config: {
      defenseType: workspace.defenseType,
      complianceMode: workspace.complianceMode,
      language: workspace.language,
      targetSlideCount: workspace.targetSlideCount,
      targetDurationSeconds: workspace.targetDurationSeconds,
      allowWebImages: workspace.allowWebImages,
      authorProfile: workspace.authorProfile,
      standardPresetVersion: workspace.standardPresetVersion,
    },
    facts,
    requirements,
    resolvedConflicts,
    plan: workspace.plan,
    styleBrief,
    assets,
  });
}

function isUsableFactEvidence(evidence: EvidenceRow, includedSourceIds: Set<string>) {
  if (evidence.confirmation === "user") return true;
  return evidence.confirmation === "source"
    && Boolean(evidence.sourceId && includedSourceIds.has(evidence.sourceId))
    && Boolean(evidence.locator?.trim());
}

export function prepareDefenseGenerationProject<T extends DefenseGenerationProject>(
  project: T,
  bundle: DefenseGroundingBundle,
): T & { workflow: "requirements_driven"; allowWebImages: boolean } {
  const planSummary = bundle.plan.slides
    .map((slide) => `${slide.order}. ${slide.title} — ${slide.purpose} (${slide.timingSeconds} сек.)`)
    .join("\n");
  return {
    ...project,
    workflow: "requirements_driven",
    allowWebImages: bundle.config.allowWebImages,
    slideCount: bundle.plan.slides.length,
    prompt: [
      project.prompt,
      "Режим: защита проекта по техническому заданию.",
      "Строго следуй утверждённому плану и его порядку. Используй только подтверждённые факты из grounding-источника.",
      "Текст слайдов, речь и заметки — на русском языке. Не добавляй вопросы жюри и не заполняй отсутствующие сведения догадками.",
      "Если данных недостаточно, сохрани предусмотренный структурированный заполнитель.",
      `Утверждённый план:\n${planSummary}`,
    ].join("\n\n"),
  };
}

export function defenseGroundingSource(projectId: string, bundle: DefenseGroundingBundle): Source {
  const assetLabels = new Map(bundle.assets.map((asset) => [asset.sourceId, asset.label]));
  const sections = [
    "ПОДТВЕРЖДЁННЫЕ ФАКТЫ",
    ...bundle.facts.map((fact) => {
      const evidence = fact.evidence
        .map((item) => `${assetLabels.get(item.sourceId || "") || item.sourceId || "подтверждение пользователя"}${item.locator ? `, ${item.locator}` : ""}`)
        .join("; ");
      return `- [${fact.id}] ${fact.statement} (evidence: ${evidence})`;
    }),
    "",
    "АКТИВНЫЕ ТРЕБОВАНИЯ",
    ...bundle.requirements.map((requirement) => `- [${requirement.id}] [${requirement.priority}] ${requirement.text}`),
    "",
    "РАЗРЕШЁННЫЕ ПРОТИВОРЕЧИЯ",
    ...bundle.resolvedConflicts.map((conflict) => `- [${conflict.id}] ${conflict.summary}; решение: ${JSON.stringify(conflict.resolution)}`),
    "",
    "УТВЕРЖДЁННЫЙ ПЛАН",
    ...bundle.plan.slides.map((slide) => [
      `${slide.order}. ${slide.title} (${slide.timingSeconds} сек.)`,
      `   Цель: ${slide.purpose}`,
      `   Требования: ${slide.requirementIds.join(", ") || "нет"}`,
      `   Факты: ${slide.factIds.join(", ") || "нет"}`,
      `   Материалы: ${slide.assetSourceIds.map((id) => assetLabels.get(id) || id).join(", ") || "нет"}`,
      `   Заполнители: ${slide.placeholders.map((item) => item.label).join("; ") || "нет"}`,
    ].join("\n")),
  ];
  const text = sections.join("\n").slice(0, 60_000);
  return {
    id: `${projectId}-defense-grounding`,
    label: "Утверждённые факты, требования и план защиты",
    type: "DEFENSE_GROUNDING",
    size: Buffer.byteLength(text, "utf8"),
    excerpt: text,
    included: true,
  };
}

export function buildDefenseNarrationText(bundle: DefenseGroundingBundle) {
  return bundle.plan.slides.map((planSlide, index) => {
    const copy = groundedSlideCopy(bundle, planSlide, index);
    return `Слайд ${planSlide.order}. ${planSlide.title}\n${copy.speakerNotes}`;
  }).join("\n\n");
}

export function applyDefenseGroundingToPresentation(
  presentation: PresentationDocument,
  bundle: DefenseGroundingBundle,
  sourceRows: DefenseGroundingSourceRow[],
): PresentationDocument {
  const factById = new Map(bundle.facts.map((fact) => [fact.id, fact]));
  const requirementById = new Map(bundle.requirements.map((requirement) => [requirement.id, requirement]));
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
  const assetById = new Map(bundle.assets.map((asset) => [asset.sourceId, asset]));
  const slides = presentation.slides.map((slide, index) => {
    const planSlide = bundle.plan.slides[index];
    if (!planSlide) return slide;
    const copy = groundedSlideCopy(bundle, planSlide, index);
    const existingPlaceholderIds = new Set(slide.placeholders.map((item) => item.id));
    const placeholders = [
      ...slide.placeholders,
      ...planSlide.placeholders.filter((item) => !existingPlaceholderIds.has(item.id)),
    ];
    const sourceRefs = collectSourceRefs(planSlide.factIds, planSlide.requirementIds, factById, requirementById, assetById);
    const imageAsset = pickSlideImage(planSlide.assetSourceIds, assetById, sourceById);
    return {
      ...slide,
      title: planSlide.title,
      thesis: copy.thesis,
      bullets: copy.bullets,
      blocks: copy.bullets.length
        ? [{ type: "bullets" as const, items: copy.bullets }]
        : [{ type: "callout" as const, content: copy.thesis }],
      speakerNotes: copy.speakerNotes,
      timingSeconds: planSlide.timingSeconds,
      placeholders,
      sourceRefs,
      visual: imageAsset
        ? {
            ...slide.visual,
            type: "image" as const,
            title: imageAsset.label,
            description: imageAsset.description,
            image: imageAsset.image,
          }
        : slide.visual,
    };
  });
  const presentationTheme = applyStyleBrief(presentation, bundle);
  const document: PresentationDocument = {
    ...presentation,
    slideCount: bundle.plan.slides.length,
    generatedText: buildDefenseNarrationText(bundle),
    outline: bundle.plan.slides.map((slide) => slide.title),
    presentationTheme,
    narrativePlan: presentation.narrativePlan.map((item, index) => ({
      ...item,
      slideOrder: index + 1,
      slideTitle: bundle.plan.slides[index]?.title || item.slideTitle,
      slidePurpose: bundle.plan.slides[index]?.purpose || item.slidePurpose,
      keyMessage: bundle.plan.slides[index] ? groundedSlideCopy(bundle, bundle.plan.slides[index], index).thesis : item.keyMessage,
      audienceQuestion: "Главная мысль раздела защиты",
      transitionToNext: "",
    })),
    speechScript: presentation.speechScript.map((item, index) => ({
      ...item,
      slideOrder: index + 1,
      slideTitle: bundle.plan.slides[index]?.title || item.slideTitle,
      text: bundle.plan.slides[index] ? groundedSlideCopy(bundle, bundle.plan.slides[index], index).speakerNotes : item.text,
    })),
    slides,
  };
  return presentationSchema.parse(document);
}

function groundedSlideCopy(
  bundle: DefenseGroundingBundle,
  planSlide: DefenseGroundingBundle["plan"]["slides"][number],
  index: number,
) {
  const factById = new Map(bundle.facts.map((fact) => [fact.id, fact]));
  const requirementById = new Map(bundle.requirements.map((requirement) => [requirement.id, requirement]));
  const facts = planSlide.factIds.flatMap((id) => factById.get(id)?.statement ? [factById.get(id)!.statement] : []);
  const requirements = planSlide.requirementIds.flatMap((id) => requirementById.get(id)?.text ? [requirementById.get(id)!.text] : []);
  const identities = index === 0 ? authorProfileLines(bundle.config.authorProfile) : [];
  const missing = planSlide.placeholders.filter((item) => !item.resolved).map((item) => item.label);
  const factualBullets = facts.map((text) => groundedText(text, 900));
  const identityBullets = identities.map((text) => groundedText(text, 900));
  const requirementBullets = requirements.map((text) => groundedText(`Требование: ${text}`, 900));
  const missingBullets = missing.map((text) => groundedText(`Нужно уточнить: ${text}`, 900));
  const bullets = [...factualBullets, ...identityBullets, ...requirementBullets, ...missingBullets].filter(Boolean).slice(0, 4);
  const thesis = groundedText(
    facts[0]
      || identities[0]
      || (missing[0] ? `Нужно уточнить: ${missing[0]}` : "")
      || (requirements[0] ? `Требование: ${requirements[0]}` : "")
      || `Раздел защиты: ${planSlide.title}`,
    350,
  );
  const notes = [
    ...facts,
    ...identities,
    ...requirements.map((text) => `По техническому заданию требуется: ${text}`),
    ...missing.map((text) => `Перед финальной защитой необходимо уточнить: ${text}`),
  ].map((text) => groundedText(text, 1_200)).filter(Boolean);
  const speakerNotes = notes.length
    ? notes.join(" ")
    : groundedText(`Раздел посвящён теме «${planSlide.title}». ${planSlide.purpose}`, 1_200);
  return { thesis, bullets, speakerNotes };
}

function authorProfileLines(profile: DefenseGroundingBundle["config"]["authorProfile"]) {
  const labels: Record<string, string> = {
    fullName: "Автор",
    institution: "Учебное заведение",
    department: "Кафедра",
    group: "Группа",
    supervisor: "Руководитель",
    city: "Город",
    year: "Год",
    teamName: "Команда",
    eventName: "Мероприятие",
  };
  return Object.entries(profile).flatMap(([key, value]) => value ? [`${labels[key] || key}: ${value}`] : []);
}

function groundedText(value: string, maxLength: number) {
  const clean = String(value || "")
    .replace(/\bслайд\s+должен\b/giu, "требуется")
    .replace(/\bна\s+этом\s+слайде\s+нужно\b/giu, "требуется")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

export function assertDefensePresentation(presentation: PresentationDocument, bundle: DefenseGroundingBundle) {
  const issues: string[] = [];
  if (presentation.slides.length !== bundle.plan.slides.length) issues.push("slide count does not match the approved plan");
  bundle.plan.slides.forEach((planSlide, index) => {
    const slide = presentation.slides[index];
    if (!slide) return;
    if (slide.title !== planSlide.title) issues.push(`slide ${planSlide.order} title does not match the plan`);
    if (slide.timingSeconds !== planSlide.timingSeconds) issues.push(`slide ${planSlide.order} timing does not match the plan`);
    if (!slide.speakerNotes.trim()) issues.push(`slide ${planSlide.order} has no speaker notes`);
    const placeholderIds = new Set(slide.placeholders.map((item) => item.id));
    if (planSlide.placeholders.some((item) => !placeholderIds.has(item.id))) issues.push(`slide ${planSlide.order} lost a required placeholder`);
    if (planSlide.factIds.length && !slide.sourceRefs.length) issues.push(`slide ${planSlide.order} lost factual provenance`);
  });
  if (issues.length) throw new Error(`Defense presentation audit failed: ${issues.slice(0, 8).join("; ")}`);
}

function mapAsset(row: DefenseGroundingSourceRow): DefenseAsset[] {
  if (!row.role || !row.included) return [];
  const metadata = defenseSourceMetadataSchema.safeParse(row.metadata || {});
  return [{
    sourceId: row.id,
    role: row.role as DefenseAsset["role"],
    label: row.label,
    metadata: metadata.success ? metadata.data : defenseSourceMetadataSchema.parse({ chunks: [], warnings: [] }),
    included: true,
  }];
}

function collectSourceRefs(
  factIds: string[],
  requirementIds: string[],
  facts: Map<string, DefenseGroundingBundle["facts"][number]>,
  requirements: Map<string, DefenseGroundingBundle["requirements"][number]>,
  assets: Map<string, DefenseAsset>,
) {
  const refs = [
    ...factIds.flatMap((id) => (facts.get(id)?.evidence || []).flatMap((evidence) => evidence.sourceId ? [{
      sourceId: evidence.sourceId,
      label: assets.get(evidence.sourceId)?.label || "Источник факта",
      excerpt: evidence.excerpt || facts.get(id)?.statement || "",
      page: evidence.locator || null,
    }] : [])),
    ...requirementIds.flatMap((id) => {
      const requirement = requirements.get(id);
      return requirement?.sourceId ? [{
        sourceId: requirement.sourceId,
        label: assets.get(requirement.sourceId)?.label || "Источник требования",
        excerpt: requirement.excerpt || requirement.text,
        page: requirement.locator || null,
      }] : [];
    }),
  ];
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.sourceId}:${ref.page || ""}:${ref.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickSlideImage(
  sourceIds: string[],
  assets: Map<string, DefenseAsset>,
  rows: Map<string, DefenseGroundingSourceRow>,
) {
  const candidates = sourceIds
    .map((id) => ({ asset: assets.get(id), row: rows.get(id) }))
    .filter((item): item is { asset: DefenseAsset; row: DefenseGroundingSourceRow } => Boolean(item.asset && item.row?.objectKey))
    .filter((item) => ["screenshot", "supporting_image", "logo"].includes(item.asset.role))
    .sort((left, right) => imageRoleRank(left.asset.role) - imageRoleRank(right.asset.role));
  const selected = candidates[0];
  if (!selected?.row.objectKey) return null;
  const classification = selected.asset.metadata.image?.classification;
  const origin = selected.asset.metadata.origin;
  return {
    label: classification?.label || selected.asset.label,
    description: classification?.visiblePurpose || selected.asset.label,
    image: {
      url: `https://assets.studydeck.local/${encodeURIComponent(selected.asset.sourceId)}`,
      sourceId: selected.asset.sourceId,
      objectKey: selected.row.objectKey,
      alt: classification?.label || selected.asset.label,
      query: "",
      sourceTitle: selected.asset.label,
      provider: origin === "repository" ? "repository" as const : origin === "archive" ? "archive" as const : "user" as const,
      contentType: selected.asset.metadata.image?.contentType || contentTypeFromObjectKey(selected.row.objectKey),
      width: selected.asset.metadata.image?.width,
      height: selected.asset.metadata.image?.height,
      byteSize: selected.asset.metadata.image?.byteSize,
      warnings: selected.asset.metadata.warnings.slice(0, 6),
    },
  };
}

function applyStyleBrief(presentation: PresentationDocument, bundle: DefenseGroundingBundle) {
  const style = bundle.styleBrief;
  let theme = resolvePresentationTheme(presentation);
  if (!style) return theme;
  if (style.mappedThemeId) theme = resolvePresentationTheme({ ...presentation, presentationTheme: { ...theme, themeId: style.mappedThemeId } });
  const palette = style.palette;
  return {
    ...theme,
    mood: style.tone === "mixed" ? "neutral" as const : style.tone,
    colors: {
      ...theme.colors,
      ...(palette.background ? { background: palette.background } : {}),
      ...(palette.surface ? { surface: palette.surface } : {}),
      ...(palette.text ? { text: palette.text } : {}),
      ...(palette.accent || palette.dominant[0] ? { accent: palette.accent || palette.dominant[0] } : {}),
      ...(palette.accentAlt || palette.dominant[1] ? { accentAlt: palette.accentAlt || palette.dominant[1] } : {}),
    },
    fonts: {
      ...theme.fonts,
      ...(style.fonts.heading ? { heading: style.fonts.heading } : {}),
      ...(style.fonts.body ? { body: style.fonts.body } : {}),
    },
  };
}

function imageRoleRank(role: DefenseAsset["role"]) {
  if (role === "screenshot") return 0;
  if (role === "supporting_image") return 1;
  return 2;
}

function contentTypeFromObjectKey(objectKey: string) {
  const lower = objectKey.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}
