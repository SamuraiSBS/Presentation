# Класс 05: Testing

В этом классе собраны библиотеки и планы для проверки StudyDeck без зависимости от live AI-провайдеров.

Используй этот класс до или после крупных изменений генерации, чтобы ловить регрессии в topic-only генерации, редакторе и export readiness.

## Библиотеки

- Playwright
  - Добавляет browser-level end-to-end тесты.
  - Нужен для проверки настоящего пользовательского пути: тема, review речи, генерация слайдов, редактирование текста и готовность к экспорту.
  - По умолчанию тесты не должны зависеть от реальных OpenAI/Yandex/Tavily.

- Vitest
  - Даёт детерминированные unit и integration тесты.
  - Нужен для shared schemas, worker generation helpers, Tavily query building, quality scoring и export-safe transformations.
  - Уже есть в проекте; задача - расширить targeted coverage.

## Рекомендуемый порядок

1. `12-vitest-targeted-tests.md`
2. `11-playwright-e2e.md`
