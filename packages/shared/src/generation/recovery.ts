export const generationFailureCategoryValues = ["transient", "quality", "layout", "image", "export_stale", "configuration", "unknown"] as const;

export const publicGenerationErrorCategoryValues = ["narration", "presentation", "image", "layout", "quality"] as const;
export type PublicGenerationErrorCategory = typeof publicGenerationErrorCategoryValues[number];

const publicGenerationFailureMessages: Record<PublicGenerationErrorCategory, string> = {
  narration: "Не удалось подготовить текст. Проект сохранён — попробуйте запустить подготовку ещё раз.",
  presentation: "Не удалось собрать презентацию. Текст выступления и источники сохранены — запустите полную AI-пересборку презентации.",
  image: "Не удалось получить один из визуалов. Текст и презентация сохранены — можно запустить полную AI-пересборку презентации.",
  layout: "Не удалось безопасно разместить содержимое презентации. Текст и источники сохранены — запустите полную AI-пересборку презентации.",
  quality: "Презентация не прошла финальную проверку качества. Текст и источники сохранены — запустите полную AI-пересборку презентации.",
};

export function publicGenerationFailureMessage(category: PublicGenerationErrorCategory) {
  return publicGenerationFailureMessages[category];
}

export type GenerationFailureCategory = typeof generationFailureCategoryValues[number];
export type SafeGenerationRecovery = { category: GenerationFailureCategory; message: string; retryable: boolean };

const recovery: Record<GenerationFailureCategory, SafeGenerationRecovery> = {
  transient: { category: "transient", message: "Подготовка временно приостановлена. Мы повторяем попытку автоматически.", retryable: true },
  quality: { category: "quality", message: "Автоматическая подготовка не прошла проверку качества после всех попыток. Материалы сохранены — запустите подготовку ещё раз.", retryable: false },
  layout: { category: "layout", message: "Не удалось завершить подготовку презентации. Попробуйте ещё раз — ваши материалы и текст сохранены.", retryable: false },
  image: { category: "image", message: "Подготовка продолжается с безопасным вариантом визуалов.", retryable: false },
  export_stale: { category: "export_stale", message: "Презентация изменилась. Подготовьте экспорт текущей версии.", retryable: true },
  configuration: { category: "configuration", message: "Не удалось завершить подготовку презентации. Попробуйте ещё раз — ваши материалы и текст сохранены.", retryable: false },
  unknown: { category: "unknown", message: "Не удалось завершить подготовку презентации. Попробуйте ещё раз — ваши материалы и текст сохранены.", retryable: false },
};

export function safeGenerationRecovery(category: GenerationFailureCategory): SafeGenerationRecovery {
  return recovery[category];
}
