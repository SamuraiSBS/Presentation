export {
  generateNarrationDraft,
  generatePresentation,
  generatePresentationFromNarration,
  buildLocalPresentationFromAcceptedNarration,
  buildSafePresentationFromNarration,
} from "./presentation/orchestrator.js";
export { selectAiProviders } from "./presentation/providers/provider-selection.js";
export {
  StructuredGenerationError,
  generateStructuredWithProvider,
} from "./presentation/providers/generation.js";
export {
  buildGenerationPrompt,
  buildNarrationPrompt,
  buildNarrativePlanPrompt,
} from "./presentation/prompts/builders.js";
export {
  normalizeNarrativePlan,
} from "./presentation/planning/builders.js";
export { findSlideTextIssues } from "./presentation/quality/orchestration.js";
export {
  inferContentLayout,
  normalizeLayout,
} from "./presentation/normalization/presentation.js";
