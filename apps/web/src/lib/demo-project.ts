import type { PresentationDocument, SlideBlock } from "@studydeck/shared";

const source = {
  id: "src-demo",
  label: "Временный сценарий для просмотра интерфейса",
  type: "DEMO",
  excerpt:
    "Демо-проект показывает, как выглядят план, редактор слайдов, заметки спикера, рассказ по слайдам и блок источников без запуска production backend.",
};

const slides: PresentationDocument["slides"] = [
  {
    id: "slide-1",
    order: 1,
    title: "StudyDeck AI: учебная презентация за один проход",
    layout: "hero",
    blocks: [
      {
        type: "bullets",
        items: [
          "Тема, файлы и требования собираются в один проект.",
          "Сервис делает план, слайды, заметки и рассказ для выступления.",
          "Пользователь может отредактировать текст перед экспортом.",
        ],
      },
      {
        type: "callout",
        content: "Цель демо: быстро проверить внешний вид сайта без базы, очередей и worker.",
      },
    ],
    speakerNotes:
      "Начать с проблемы: студенту часто нужно быстро собрать понятную презентацию и при этом разобраться в материале.",
    timingSeconds: 45,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
  {
    id: "slide-2",
    order: 2,
    title: "Кому это помогает",
    layout: "bullets",
    blocks: [
      {
        type: "bullets",
        items: [
          "Школьникам, которым нужен доклад по теме.",
          "Студентам, которые готовят семинар или защиту проекта.",
          "Преподавателям, которым нужен черновик урока или объяснения.",
        ],
      },
      {
        type: "callout",
        content: "Интерфейс должен ощущаться как учебный помощник, а не как генератор готовой домашней работы.",
      },
    ],
    speakerNotes:
      "Пояснить, что продукт не только оформляет слайды, но и помогает структурировать материал для понимания.",
    timingSeconds: 55,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
  {
    id: "slide-3",
    order: 3,
    title: "Рабочий процесс",
    layout: "two-column",
    blocks: [
      {
        type: "bullets",
        items: [
          "Описать тему и выбрать сценарий.",
          "Добавить PDF, DOCX, PPTX, TXT или конспект.",
          "Проверить план и источники.",
          "Отредактировать слайды и речь.",
        ],
      },
      {
        type: "callout",
        content: "Главная ценность: весь путь от идеи до экспорта живет в одном проекте.",
      },
    ],
    speakerNotes:
      "Провести слушателя по шагам: сначала ввод, затем генерация, потом редактура и экспорт.",
    timingSeconds: 60,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
  {
    id: "slide-4",
    order: 4,
    title: "Что видно в редакторе",
    layout: "bullets",
    blocks: [
      {
        type: "bullets",
        items: [
          "Слева список слайдов и структура презентации.",
          "В центре холст с текущим слайдом.",
          "Справа речь и источники для проверки тезисов.",
        ],
      },
      {
        type: "quote",
        content: "Редактор нужен для контроля смысла, а не только для косметики.",
      },
    ],
    speakerNotes:
      "Подчеркнуть, что пользователь видит и слайды, и текст выступления, поэтому может быстро поправить содержание.",
    timingSeconds: 55,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
  {
    id: "slide-5",
    order: 5,
    title: "Экспорт и следующий шаг",
    layout: "summary",
    blocks: [
      {
        type: "bullets",
        items: [
          "После проверки презентацию можно подготовить к PDF или PPTX.",
          "Источники и заметки остаются рядом с проектом.",
          "Временный сценарий можно удалить после визуальной проверки.",
        ],
      },
      {
        type: "callout",
        content: "Этот demo-проект не трогает production-данные и нужен только для просмотра сайта.",
      },
    ],
    speakerNotes:
      "Завершить тем, что демо показывает основные экраны и не требует запуска полной инфраструктуры.",
    timingSeconds: 45,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
];

export const demoPresentation: PresentationDocument = {
  id: "presentation-demo",
  title: "Временный сценарий презентации",
  scenario: "Школьный доклад",
  level: "8-11 класс",
  slideCount: slides.length,
  generationMode: "demo",
  sources: [source],
  outline: slides.map((slide) => slide.title),
  speechScript: slides.map((slide) => ({
    slideOrder: slide.order,
    slideTitle: slide.title,
    text: `${slide.speakerNotes} Ключевые тезисы: ${slide.blocks
      .flatMap((block) => (block.type === "bullets" ? block.items : [block.content]))
      .join(" ")}`,
  })),
  slides,
};

export const demoProject = {
  id: "demo",
  title: demoPresentation.title,
  status: "ready",
  slideCount: demoPresentation.slideCount,
  updatedAt: new Date("2026-06-12T12:00:00.000Z").toISOString(),
  sources: demoPresentation.sources,
  exports: [],
  presentation: {
    id: demoPresentation.id,
    document: demoPresentation,
  },
};

export function updateDemoSlide(slideId: string, input: { title?: string; blocks?: SlideBlock[]; speakerNotes?: string }) {
  const nextSlides = demoPresentation.slides.map((slide) =>
    slide.id === slideId
      ? {
          ...slide,
          title: input.title ?? slide.title,
          blocks: input.blocks ?? slide.blocks,
          speakerNotes: input.speakerNotes ?? slide.speakerNotes,
        }
      : slide,
  );

  const nextPresentation: PresentationDocument = {
    ...demoPresentation,
    outline: nextSlides.map((slide) => slide.title),
    slides: nextSlides,
  };

  return {
    ...demoProject,
    title: nextPresentation.title,
    presentation: {
      id: nextPresentation.id,
      document: nextPresentation,
    },
  };
}
