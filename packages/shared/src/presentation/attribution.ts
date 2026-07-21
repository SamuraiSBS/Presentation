import type { Source, SourceRef } from "../projects/schemas.js";
import type { SlideVisualImage } from "./schemas.js";

const SOURCE_FOOTER_LIMIT = 3;

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shortDomain(value: string | undefined) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function shortLabel(value: string, limit = 54) {
  const text = clean(value);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

/**
 * Keeps document provenance valid without turning a footer into a second
 * source store. The document retains every valid reference; renderers choose
 * their own compact visible subset through formatSlideAttribution.
 */
export function normalizeSourceRefs(
  refs: unknown,
  sources: Source[],
): SourceRef[] {
  if (!Array.isArray(refs) || !sources.length) return [];
  const byId = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();

  return refs.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Partial<SourceRef>;
    const sourceId = clean(raw.sourceId);
    const source = byId.get(sourceId);
    if (!source || seen.has(sourceId)) return [];
    seen.add(sourceId);
    return [{
      sourceId,
      label: clean(raw.label) || clean(source.label) || "Источник",
      excerpt: clean(raw.excerpt) || clean(source.excerpt),
      page: clean(raw.page) || null,
    }];
  });
}

export function sourceRefFromSource(source: Source): SourceRef {
  return {
    sourceId: source.id,
    label: clean(source.label) || "Источник",
    excerpt: clean(source.excerpt),
    page: null,
  };
}

export function formatSourceReference(ref: SourceRef, source?: Source) {
  const label = shortLabel(ref.label || source?.label || shortDomain(source?.url) || "Источник");
  return label || "Источник";
}

export function formatImageAttribution(image?: SlideVisualImage) {
  if (!image) return "";
  const title = shortLabel(image.sourceTitle || shortDomain(image.sourceUrl));
  if (image.provider === "user") return title ? `Источник: ${title}` : "Источник: материалы пользователя";
  return title ? `Фото: ${title}` : "";
}

/** A single compact footer string shared by canvas, PPTX and PDF renderers. */
export function formatSlideAttribution(
  refs: SourceRef[] = [],
  image?: SlideVisualImage,
  sources: Source[] = [],
  limit = SOURCE_FOOTER_LIMIT,
) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const sourceLabels = refs
    .slice(0, limit)
    .map((ref, index) => `[${index + 1}] ${formatSourceReference(ref, byId.get(ref.sourceId))}`);
  const content = sourceLabels.length ? `Источники: ${sourceLabels.join(" ")}` : "";
  return [content, formatImageAttribution(image)].filter(Boolean).join(" · ");
}
