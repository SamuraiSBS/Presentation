import type { PresentationDocument, QualityIssue, Source } from "@studydeck/shared";

/** Source checks are injected so this module never imports the quality facade. */
export function collectSourceGroundingIssues(
  presentation: PresentationDocument,
  sources: Source[],
  checks: Array<(presentation: PresentationDocument, sources: Source[]) => QualityIssue[]>,
) {
  return checks.flatMap((check) => check(presentation, sources));
}
