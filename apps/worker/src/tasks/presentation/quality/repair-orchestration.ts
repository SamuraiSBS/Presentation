import type { PresentationDocument } from "@studydeck/shared";

/** Keeps deterministic repair composition explicit and facade-independent. */
export function applyInitialQualityRepairs(
  presentation: PresentationDocument,
  repairs: Array<(presentation: PresentationDocument) => PresentationDocument>,
) {
  return repairs.reduce((document, repair) => repair(document), presentation);
}
