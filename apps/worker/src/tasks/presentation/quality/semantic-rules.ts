import type { PresentationDocument, QualityIssue } from "@studydeck/shared";

/** Deterministic semantic checks assembled without source or repair concerns. */
export function collectSemanticQualityIssues(
  presentation: PresentationDocument,
  checks: Array<(presentation: PresentationDocument) => QualityIssue[]>,
) {
  return checks.flatMap((check) => check(presentation));
}
