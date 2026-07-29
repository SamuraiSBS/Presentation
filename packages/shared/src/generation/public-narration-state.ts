/**
 * Stable, text-free terminal states that the API may expose for narration
 * routing. They intentionally carry no provider, validation, or recovery
 * diagnostic detail.
 */
export const publicNarrationStateValues = [
  "source_preparation_failed",
  "narration_failed",
  "editable_draft",
  "accepted_speech",
] as const;

export type PublicNarrationState = typeof publicNarrationStateValues[number];

export function isPublicNarrationState(value: unknown): value is PublicNarrationState {
  return typeof value === "string" && (publicNarrationStateValues as readonly string[]).includes(value);
}

export function publicNarrationFailureMessage(state: Extract<PublicNarrationState, "source_preparation_failed" | "narration_failed">) {
  if (state === "source_preparation_failed") {
    return "Не удалось подготовить текст выступления. Проект сохранён — запустите подготовку ещё раз, когда будете готовы.";
  }
  return "Не удалось завершить подготовку текста выступления. Проект сохранён — запустите подготовку ещё раз, когда будете готовы.";
}
