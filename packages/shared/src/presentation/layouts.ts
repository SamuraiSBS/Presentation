import type { SlideKind, SlideLayout, SlideLayoutDefinition } from "./schemas.js";
export const SLIDE_LAYOUT_DEFINITIONS: SlideLayoutDefinition[] = [
  { id: "hero", label: "Титульный", description: "Название и вводный тезис", kinds: ["title", "section"], requirements: [], fallback: "hero" },
  { id: "summary", label: "Итоги", description: "Главные выводы презентации", kinds: ["summary"], requirements: [], fallback: "summary" },
  { id: "statement", label: "Главный тезис", description: "Одна сильная мысль", kinds: ["content"], requirements: [], fallback: "bullets" },
  { id: "bullets", label: "Список", description: "Короткие тезисы", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "two-column", label: "Две колонки", description: "Два связанных блока", kinds: ["content"], requirements: ["comparison"], fallback: "bullets" },
  { id: "quote", label: "Цитата", description: "Центральная формулировка", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "definition", label: "Определение", description: "Термин и объяснение", kinds: ["content"], requirements: ["definition"], fallback: "explain-example" },
  { id: "timeline", label: "Хронология", description: "События на временной оси", kinds: ["content"], requirements: ["sequence"], fallback: "process" },
  { id: "comparison", label: "Сравнение", description: "Сравнение по нескольким критериям", kinds: ["content"], requirements: ["comparison"], fallback: "bullets" },
  { id: "process", label: "Процесс", description: "Последовательность шагов", kinds: ["content"], requirements: ["sequence"], fallback: "bullets" },
  { id: "image-focus", label: "Изображение", description: "Визуальный пример и пояснение", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "case-study", label: "Кейс", description: "Ситуация, действие, результат", kinds: ["content"], requirements: ["sequence"], fallback: "process" },
  { id: "question-answer", label: "Вопрос и ответ", description: "Вопрос с ясным ответом", kinds: ["content"], requirements: [], fallback: "statement" },
  { id: "myth-fact", label: "Миф и факт", description: "Исправление заблуждения", kinds: ["content"], requirements: ["comparison"], fallback: "statement" },
  { id: "metrics", label: "Показатели", description: "Только реальные числа и величины", kinds: ["content"], requirements: ["metrics"], fallback: "statement" },
  { id: "evidence", label: "Тезис и доказательства", description: "Тезис, факты и компактные источники", kinds: ["content"], requirements: [], fallback: "bullets" },
  { id: "problem-solution", label: "Проблема и решение", description: "Проблема, причина и решение", kinds: ["content"], requirements: ["sequence"], fallback: "process" },
  { id: "explain-example", label: "Объяснение и пример", description: "Понятие, объяснение, пример и оговорка", kinds: ["content"], requirements: [], fallback: "definition" },
];

const HIDDEN_SLIDE_LAYOUTS = new Set<SlideLayout>([
  "bullets",
  "case-study",
  "comparison",
  "definition",
  "evidence",
  "explain-example",
  "myth-fact",
  "problem-solution",
  "question-answer",
]);

export function slideLayoutDefinition(layout: SlideLayout) {
  return SLIDE_LAYOUT_DEFINITIONS.find((item) => item.id === layout) || SLIDE_LAYOUT_DEFINITIONS[0];
}

export function slideLayoutOptions(kind: SlideKind) {
  return SLIDE_LAYOUT_DEFINITIONS.filter((item) => item.id !== "two-column" && !HIDDEN_SLIDE_LAYOUTS.has(item.id) && item.kinds.includes(kind));
}
