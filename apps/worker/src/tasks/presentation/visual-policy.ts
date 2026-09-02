import type { Slide } from "@studydeck/shared";

export type VisualQuota = {
  photos: number;
  diagrams: number;
  text: number;
};

export const VISUAL_QUOTA_MATRIX: Readonly<Record<number, VisualQuota>> = Object.freeze({
  6: Object.freeze({ photos: 3, diagrams: 2, text: 1 }),
  8: Object.freeze({ photos: 4, diagrams: 2, text: 2 }),
  10: Object.freeze({ photos: 5, diagrams: 3, text: 2 }),
  12: Object.freeze({ photos: 6, diagrams: 4, text: 2 }),
  14: Object.freeze({ photos: 7, diagrams: 5, text: 2 }),
});

export const MANAGED_SLIDE_COUNTS = Object.freeze([6, 8, 10, 12, 14]);

export function isManagedSlideCount(slideCount: number): boolean {
  return MANAGED_SLIDE_COUNTS.includes(slideCount);
}

export function visualQuotaForSlideCount(slideCount: number): VisualQuota | undefined {
  const quota = VISUAL_QUOTA_MATRIX[slideCount];
  return quota ? { ...quota } : undefined;
}

export function targetPhotoCount(slideCount: number) {
  return visualQuotaForSlideCount(slideCount)?.photos;
}

export function targetDiagramCount(slideCount: number) {
  return visualQuotaForSlideCount(slideCount)?.diagrams;
}

export function targetTextSlideCount(slideCount: number) {
  return visualQuotaForSlideCount(slideCount)?.text;
}

const SEMANTIC_DIAGRAM_TYPES = new Set([
  "process_diagram",
  "comparison_diagram",
  "cause_effect_diagram",
  "before_after_table",
  "pros_cons_table",
  "timeline",
  "mind_map",
  "schema",
]);

export function hasSubstantiveVisual(slide: Slide | undefined): boolean {
  if (!slide) return false;
  const visual = slide.visual;
  if (visual.image) return true;

  const hasItems = visual.items.filter((item) => Boolean(cleanVisualText(item.label) || cleanVisualText(item.text))).length >= 2;
  const hasRows = visual.rows.filter((row) => Boolean(cleanVisualText(row.label) || cleanVisualText(row.left) || cleanVisualText(row.right))).length >= 2;
  const hasGraph = Boolean(visual.graph && visual.graph.nodes.length >= 2 && visual.graph.edges.length >= 1);
  const hasMermaid = Boolean(visual.diagram && hasSubstantiveMermaid(visual.diagram.source, visual.diagram.kind));

  if (hasGraph || hasMermaid) return true;
  if (!SEMANTIC_DIAGRAM_TYPES.has(visual.type)) return false;
  return hasItems || hasRows;
}

function hasSubstantiveMermaid(source: string, kind: string) {
  const normalized = source.replace(/\r/g, "");
  const labeledNodes = new Set<string>();
  for (const match of normalized.matchAll(/\b([A-Za-z][\w-]*)\s*(?:\[([^\]]+)\]|\(\(([^)]+)\)\)|\(([^)]+)\))/g)) {
    const label = cleanVisualText(match[2] || match[3] || match[4]);
    if (label) labeledNodes.add(`${match[1]}:${label}`.toLowerCase());
  }
  const timelineEntries = [...normalized.matchAll(/^\s*[^\n:]{2,}\s*:\s*[^\n]+$/gm)]
    .map((match) => cleanVisualText(match[0]))
    .filter(Boolean);
  const nodeCount = Math.max(labeledNodes.size, kind === "timeline" ? timelineEntries.length : 0);
  const hasConnection = /(?:-->|==>|-.->|---|->)/.test(normalized) || (kind === "timeline" && timelineEntries.length >= 2);
  return nodeCount >= 2 && hasConnection;
}

function cleanVisualText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
