# Класс 04: Observability

В этом классе собраны библиотеки, которые помогают понять, почему ломается генерация, API, worker или export.

Используй этот класс, когда StudyDeck нужна production-grade видимость долгих AI-задач.

## Библиотеки

- Sentry
  - Ловит runtime errors в web, API и worker.
  - Нужен для ошибок генерации, падений экспорта, проблем AI-провайдера и пользовательских frontend-исключений.
  - Нельзя отправлять в Sentry секреты, полные промты или полный сгенерированный контент.

- `pino`
  - Добавляет структурные runtime-логи.
  - Нужен для Docker logs, стадий worker, AI provider calls, поиска, image processing и export diagnostics.
  - Начинать стоит с безопасных полей: project ID, job ID, stage, duration и краткое описание ошибки.

- OpenTelemetry
  - Добавляет трассировку через API, worker, AI calls, search, images и export.
  - Полезен после базового Sentry и структурных логов.
  - Должен быть выключен, пока его явно не включили через env.

## Рекомендуемый порядок

1. `08-sentry-observability.md`
2. `09-pino-logging.md`
3. `16-opentelemetry-tracing.md`
