export const generationFailureCategoryValues = ["transient", "quality", "layout", "image", "export_stale", "configuration", "unknown"] as const;

export type GenerationFailureCategory = typeof generationFailureCategoryValues[number];
export type SafeGenerationRecovery = { category: GenerationFailureCategory; message: string; retryable: boolean };

const recovery: Record<GenerationFailureCategory, SafeGenerationRecovery> = {
  transient: { category: "transient", message: "Подготовка временно приостановлена. Мы повторяем попытку автоматически.", retryable: true },
  quality: { category: "quality", message: "Не удалось завершить подготовку презентации. Попробуйте ещё раз — ваши материалы и текст сохранены.", retryable: false },
  layout: { category: "layout", message: "Не удалось завершить подготовку презентации. Попробуйте ещё раз — ваши материалы и текст сохранены.", retryable: false },
  image: { category: "image", message: "Подготовка продолжается с безопасным вариантом визуалов.", retryable: false },
  export_stale: { category: "export_stale", message: "Презентация изменилась. Подготовьте экспорт текущей версии.", retryable: true },
  configuration: { category: "configuration", message: "Не удалось завершить подготовку презентации. Попробуйте ещё раз — ваши материалы и текст сохранены.", retryable: false },
  unknown: { category: "unknown", message: "Не удалось завершить подготовку презентации. Попробуйте ещё раз — ваши материалы и текст сохранены.", retryable: false },
};

export function safeGenerationRecovery(category: GenerationFailureCategory): SafeGenerationRecovery {
  return recovery[category];
}
