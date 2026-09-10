import crypto from "node:crypto";
import {
  slideContentLockSchema,
  type Slide,
  type SlideContentLock,
  type SlideTextComposition,
} from "@studydeck/shared";

export type ContentLockDraft = {
  title: string;
  thesis: string;
  composition: SlideTextComposition;
  labels?: Array<{ key: string; text: string }>;
  facts?: string[];
};

/**
 * Makes design input immutable and auditable.  A caller may improve the
 * concise text beforehand, but every string that ends up on screen must be
 * present here before any art-direction or scene call begins.
 */
export function createSlideContentLock(slide: Pick<Slide, "id" | "order" | "title" | "thesis" | "layout" | "bullets" | "blocks">, draft?: Partial<ContentLockDraft>): SlideContentLock {
  const composition = draft?.composition || inferComposition(slide);
  const title = clean(draft?.title || slide.title);
  const thesis = clean(draft?.thesis || slide.thesis || firstSlideSentence(slide));
  const labels = draft?.labels || defaultLabels(slide);
  const text = [
    { key: "title", text: title },
    { key: "thesis", text: thesis },
    ...labels.map((item) => ({ key: normalizeLabelKey(item.key), text: clean(item.text) })),
  ].filter((item) => item.text);
  const facts = [...new Set((draft?.facts || []).map(clean).filter(Boolean))];
  const contentHash = hash({ slideId: slide.id, slideOrder: slide.order, composition, title, thesis, text, facts });
  return slideContentLockSchema.parse({ slideId: slide.id, slideOrder: slide.order, composition, title, thesis, text, facts, contentHash });
}

export function contentLockText(lock: SlideContentLock, key: string) {
  return lock.text.find((item) => item.key === key)?.text || "";
}

export function assertContentLockUnchanged(previous: SlideContentLock, next: SlideContentLock) {
  if (previous.contentHash !== next.contentHash) throw new Error("ai_scene_content_hash_changed");
}

function inferComposition(slide: Pick<Slide, "layout" | "bullets" | "blocks">): SlideTextComposition {
  if (slide.layout === "process" || slide.layout === "timeline") return "process";
  if (slide.layout === "comparison" || slide.layout === "two-column") return "comparison";
  if (slide.layout === "definition") return "definition";
  return slide.bullets.length > 1 ? "enumeration" : "statement";
}

function defaultLabels(slide: Pick<Slide, "bullets" | "blocks">) {
  const fromBullets = slide.bullets.slice(0, 4);
  const fromBlocks = slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : block.type === "callout" ? [block.content] : []);
  return [...new Set([...fromBullets, ...fromBlocks])].slice(0, 4).map((text, index) => ({ key: `label:${index + 1}`, text }));
}

function firstSlideSentence(slide: Pick<Slide, "blocks">) {
  const value = slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : block.type === "callout" ? [block.content] : [])[0] || "";
  return value.split(/(?<=[.!?])\s+/u)[0] || value;
}

function normalizeLabelKey(value: string) {
  const normalized = clean(value).replace(/^label:/i, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `label:${normalized || "item"}`;
}

function clean(value: string) { return value.replace(/\s+/g, " ").trim(); }
function hash(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
