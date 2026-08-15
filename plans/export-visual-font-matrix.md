# P2-5: матрица визуальной совместимости экспорта

## Зафиксированный шрифтовой контракт

- Во всех штатных темах и в canvas/PPTX/PDF-проекции экспорт использует `Arial`.
- В worker image PDF/Chromium разрешает его через `Liberation Sans`, затем `Noto Sans` и `DejaVu Sans`. `font-liberation` установлен непосредственно в immutable worker image.
- Имена нестандартных шрифтов из ранее сохранённых или пользовательских canvas не проходят в экспорт: они нормализуются в `Arial`. Это намеренно исключает неявную подстановку, меняющую переносы.

## Автоматическая матрица

| Сценарий | PPTX | PDF/HTML | Автоматическая проверка |
| --- | --- | --- | --- |
| Все premium themes | Цвета и `Arial` в OOXML | Theme CSS font stack | `apps/worker/src/tasks/export.test.ts` |
| Custom canvas с устаревшим шрифтом | Нормализация к `Arial` | Fallback stack с Liberation Sans | `export.test.ts`, `font-policy.test.ts` |
| Русский текст, диаграммы, таблицы, notes, source attribution | Сериализация в OOXML | Рендер через Chromium/PDF | существующие export fixtures и `export.test.ts` |

Запуск в worker image/CI:

```powershell
npm run build -w @studydeck/shared
npm run test -w @studydeck/worker -- --run src/tasks/export.test.ts src/tasks/export-storage-policy.test.ts
docker compose build worker
docker compose run --rm worker npm run test -w @studydeck/worker -- --run src/tasks/export.test.ts
```

## Ручная acceptance-матрица

Перед production release открыть один и тот же fixture export в Windows PowerPoint и LibreOffice, а PDF — в Chromium/Acrobat. Для каждого из трёх viewer'ов подтвердить: русский текст без подстановки/переполнения, comparison table, Mermaid diagram, speaker notes, source attribution и все восемь тем. Сохранить скриншоты и версии viewer'ов в release artifact. Это ручное принятие нельзя заменить тестом worker image.

## Хранение экспортов

- Worker maintenance каждые 15 минут удаляет ready/failed export records и их objects старше `EXPORT_RETENTION_DAYS` (default 30).
- Перед upload новый export проверяется против `EXPORT_STORAGE_QUOTA_BYTES_PER_PROJECT` (default 512 MiB); размер сохраняется в `Export.sizeBytes`.
- Если export уже загружен, но publication не состоялся, worker удаляет этот unpublished object и не оставляет его в квоте.
