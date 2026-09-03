import { publicGenerationFailureMessage, type PublicGenerationErrorCategory, type PublicNarrationState } from "@studydeck/shared";

type NarrationFailureUi = {
  title: string;
  message: string;
};

export function narrationReviewMode(input: {
  status: string;
  speechDraft?: string | null;
  narrationState?: PublicNarrationState | null;
}) {
  if (input.narrationState === "editable_draft" || input.narrationState === "accepted_speech" || input.speechDraft?.trim()) {
    return "editor" as const;
  }
  if (input.status === "failed") return "failure" as const;
  return "pending" as const;
}

/** Public narration states are the sole input for terminal failure copy. */
export function narrationFailureUi(
  state: PublicNarrationState | null | undefined,
  category?: PublicGenerationErrorCategory | null,
): NarrationFailureUi {
  if (category && category !== "narration") {
    return {
      title: "Не удалось собрать презентацию",
      message: publicGenerationFailureMessage(category),
    };
  }
  if (state === "source_preparation_failed") {
    return {
      title: "Не удалось подготовить текст",
      message: "Подготовить речь не удалось. Проект сохранён — запустите подготовку ещё раз, когда будете готовы.",
    };
  }
  return {
    title: "Не удалось завершить подготовку текста",
    message: "Проект сохранён — запустите подготовку ещё раз, когда будете готовы.",
  };
}
