import { auditSlideCanvas, type PresentationDocument, type Source } from "@studydeck/shared";
import { findFactualRiskIssues, findSpeechTimingIssues, type QualityProjectInput } from "./tasks/presentation-quality.js";
import { parseMandatorySourceSnapshot } from "./source-snapshot.js";

type ReservationStatus = "reserved" | "settled" | "released" | "provider_error" | "unknown_usage" | "overrun";

export type EconomicReleaseGateInput = {
  presentation: PresentationDocument;
  sources: Source[];
  project: QualityProjectInput;
  envelope: {
    limitRub: string;
    reservedRub: string;
    settledRub: string;
    status: string;
    sourceSnapshot: unknown;
    reservations: Array<{ status: ReservationStatus; reason: string | null }>;
    imageSearchQueries: number;
  };
};

export type EconomicReleaseGateResult = {
  passed: boolean;
  categories: string[];
};

/**
 * Final non-network release check for a new economic standard run.  It is
 * deliberately separate from presentation-quality.ts because it also checks
 * persisted run state that a document-only quality check cannot see.
 */
export function evaluateEconomicReleaseGate(input: EconomicReleaseGateInput): EconomicReleaseGateResult {
  const categories = new Set<string>();
  const { presentation, sources, project, envelope } = input;
  const snapshot = parseMandatorySourceSnapshot(envelope.sourceSnapshot);

  if (!snapshot || snapshot.sources.length < 3) categories.add("source_snapshot");
  if (presentation.slideCount !== project.slideCount || presentation.slides.length !== project.slideCount
    || new Set(presentation.slides.map((slide) => slide.order)).size !== project.slideCount
    || !presentation.slides.every((slide, index) => slide.order === index + 1)) {
    categories.add("slide_count");
  }
  if (findSpeechTimingIssues(presentation, project).length) categories.add("accepted_narration_timing");
  if (findFactualRiskIssues(presentation, sources).length) categories.add("source_refs");
  if (presentation.slides.some((slide) => !slide.canvas || auditSlideCanvas(slide.canvas).length)) categories.add("canvas_audit");

  const tavilyImages = presentation.slides.filter((slide) => slide.visual.image?.provider === "tavily").length;
  if (tavilyImages > 2 || envelope.imageSearchQueries > 2) categories.add("visual_cap");

  if (rubUnits(envelope.reservedRub) + rubUnits(envelope.settledRub) > rubUnits(envelope.limitRub)) {
    categories.add("cost_envelope");
  }
  if ((envelope.status === "exhausted" && !project.acceptedNarrationRecovery) || envelope.status === "cancelled"
    || envelope.reservations.some((reservation) => !isResolvedReservation(reservation))) {
    categories.add("paid_stage_unresolved");
  }

  return { passed: categories.size === 0, categories: [...categories].sort() };
}

function isResolvedReservation(reservation: { status: ReservationStatus; reason: string | null }) {
  if (reservation.status === "settled" || reservation.status === "released") return true;
  // AITUNNEL image generation is synchronous but its provider-reported price
  // can exceed the bounded web-search reservation by a few kopecks. The
  // actual charge is already settled and the global envelope cap above still
  // protects the run; treat only this explicit image-generation overrun as
  // resolved, never an unknown or transport failure.
  return reservation.status === "overrun" && reservation.reason === "presentation_image_generation";
}

export class EconomicReleaseGateError extends Error {
  constructor(public readonly categories: string[]) {
    super(`Economic release gate rejected: ${categories.join(",") || "unknown"}`);
    this.name = "EconomicReleaseGateError";
  }
}

function rubUnits(value: string) {
  const [whole, fraction = ""] = String(value || "0").split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return 10_000_000_000n;
  return BigInt(whole) * 100_000_000n + BigInt(`${fraction}00000000`.slice(0, 8));
}
