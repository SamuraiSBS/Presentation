import type { Source } from "@studydeck/shared";

export const MANDATORY_SOURCE_SNAPSHOT_MINIMUM = 3;
export const MANDATORY_SOURCE_SNAPSHOT_MAXIMUM = 4;
export const MANDATORY_SOURCE_EXCERPT_MAX_LENGTH = 320;
export const MANDATORY_SOURCE_CONTEXT_MAX_LENGTH = 1_200;

export type MandatorySourceSnapshot = {
  version: 1;
  capturedAt: string;
  provenance: { provider: "tavily"; queryAt: string };
  sources: Array<{
    sourceId: string;
    title: string;
    url: string;
    evidenceExcerpt: string;
  }>;
};

export function createMandatorySourceSnapshot(sources: Source[], capturedAt = new Date()): MandatorySourceSnapshot | null {
  const selected = sources
    .filter((source) => source.type === "WEB" && source.url)
    .slice(0, MANDATORY_SOURCE_SNAPSHOT_MAXIMUM)
    .map((source) => ({
      sourceId: source.id,
      title: compactText(source.label, 180),
      url: source.url!,
      evidenceExcerpt: compactText(source.excerpt, MANDATORY_SOURCE_EXCERPT_MAX_LENGTH),
    }))
    .filter((source) => source.title && source.evidenceExcerpt);
  if (selected.length < MANDATORY_SOURCE_SNAPSHOT_MINIMUM) return null;

  let remaining = MANDATORY_SOURCE_CONTEXT_MAX_LENGTH;
  const bounded = selected.map((source) => {
    const evidenceExcerpt = compactText(source.evidenceExcerpt, Math.max(0, remaining));
    remaining -= evidenceExcerpt.length;
    return { ...source, evidenceExcerpt };
  }).filter((source) => source.evidenceExcerpt);
  return bounded.length >= MANDATORY_SOURCE_SNAPSHOT_MINIMUM
    ? { version: 1, capturedAt: capturedAt.toISOString(), provenance: { provider: "tavily", queryAt: capturedAt.toISOString() }, sources: bounded }
    : null;
}

export function parseMandatorySourceSnapshot(value: unknown): MandatorySourceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<MandatorySourceSnapshot>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.sources) || snapshot.sources.length < MANDATORY_SOURCE_SNAPSHOT_MINIMUM) return null;
  const sources = snapshot.sources.slice(0, MANDATORY_SOURCE_SNAPSHOT_MAXIMUM).flatMap((source) => {
    if (!source || typeof source !== "object") return [];
    const item = source as MandatorySourceSnapshot["sources"][number];
    if (!item.sourceId || !item.title || !item.url || !item.evidenceExcerpt) return [];
    return [{ sourceId: String(item.sourceId), title: compactText(item.title, 180), url: String(item.url), evidenceExcerpt: compactText(item.evidenceExcerpt, MANDATORY_SOURCE_EXCERPT_MAX_LENGTH) }];
  });
  return sources.length >= MANDATORY_SOURCE_SNAPSHOT_MINIMUM
    ? { version: 1, capturedAt: String(snapshot.capturedAt || ""), provenance: { provider: "tavily", queryAt: String(snapshot.provenance?.queryAt || snapshot.capturedAt || "") }, sources }
    : null;
}

export function snapshotSources(snapshot: MandatorySourceSnapshot): Source[] {
  return snapshot.sources.map((source) => ({ id: source.sourceId, label: source.title, type: "WEB", size: 0, excerpt: source.evidenceExcerpt, url: source.url, included: true }));
}

function compactText(value: string, maxLength: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength);
  return shortened.slice(0, Math.max(1, shortened.lastIndexOf(" "))) || shortened;
}
