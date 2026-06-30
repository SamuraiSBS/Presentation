import { ensureEditableCanvas, type PresentationDocument, type SlideBlock, type SlideCanvas } from "@studydeck/shared";

const source = {
  id: "src-demo",
  label: "Временный сценарий для просмотра интерфейса",
  type: "DEMO",
  excerpt:
    "Демо-проект показывает, как выглядят план, редактор слайдов, заметки докладчика и рассказ по слайдам без запуска рабочего сервера.",
};

const slides: any[] = [
  {
    id: "slide-1",
    order: 1,
    title: "StudyDeck AI: учебная презентация за один проход",
    layout: "hero",
    blocks: [
      {
        type: "callout",
        content: "StudyDeck AI собирает тему, материалы и требования в один проект, а затем готовит слайды и подробный рассказ для выступления.",
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
        type: "callout",
        content: "Сервис помогает школьникам, студентам и преподавателям быстро превратить тему в понятную структуру выступления.",
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
    layout: "process",
    thesis: "Каждый этап превращает исходный материал в готовое выступление.",
    bullets: [
      "Пользователь задаёт тему и добавляет материалы",
      "Сервис собирает структуру и содержание",
      "Результат проверяется, редактируется и экспортируется",
    ],
    visual: {
      type: "process_diagram",
      title: "",
      description: "Учебный процесс от темы и материалов до готовой презентации",
      leftLabel: "",
      rightLabel: "",
      items: [
        { label: "Подготовить материал", text: "Описать тему, требования и добавить доступные источники." },
        { label: "Собрать презентацию", text: "Получить план, слайды, заметки и связный текст выступления." },
        { label: "Проверить и экспортировать", text: "Уточнить формулировки и скачать результат в PDF или PPTX." },
      ],
      rows: [],
    },
    blocks: [
      {
        type: "callout",
        content: "Весь путь от темы до экспорта остается в одном проекте: сначала ввод, затем генерация, редактура и скачивание.",
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
        type: "quote",
        content: "Редактор показывает текущий слайд и текст презентации, чтобы быстрее поправить смысл перед экспортом.",
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
        type: "callout",
        content: "После проверки презентацию можно подготовить к PDF или PPTX, а затем вернуться к проекту для правок.",
      },
    ],
    speakerNotes:
      "Завершить тем, что демо показывает основные экраны и не требует запуска полной инфраструктуры.",
    timingSeconds: 45,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
];

export const demoPresentation: PresentationDocument = ensureEditableCanvas({
  id: "presentation-demo",
  title: "Временный сценарий презентации",
  scenario: "university_report",
  level: "university_student",
  slideCount: slides.length,
  generationMode: "demo",
  generatedText: slides
    .map((slide) => `Слайд ${slide.order}: ${slide.title}\n${slide.speakerNotes}`)
    .join("\n\n"),
  sources: [source],
  outline: slides.map((slide) => slide.title),
  narrativePlan: [],
  speechScript: slides.map((slide) => ({
    slideOrder: slide.order,
    slideTitle: slide.title,
    text: `${slide.speakerNotes} Ключевые тезисы: ${slide.blocks
      .flatMap((block: SlideBlock) => (block.type === "bullets" ? block.items : [block.content]))
      .join(" ")}`,
  })),
  slides: slides as PresentationDocument["slides"],
});

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

export function updateDemoSlide(slideId: string, input: { title?: string; blocks?: SlideBlock[]; canvas?: SlideCanvas; speakerNotes?: string }) {
  const nextSlides = demoPresentation.slides.map((slide) =>
    slide.id === slideId
      ? {
          ...slide,
          title: input.title ?? slide.title,
          blocks: input.blocks ?? slide.blocks,
          canvas: input.canvas ?? slide.canvas,
          speakerNotes: input.speakerNotes ?? slide.speakerNotes,
        }
      : slide,
  );

  const nextPresentation: PresentationDocument = ensureEditableCanvas({
    ...demoPresentation,
    outline: nextSlides.map((slide) => slide.title),
    slides: nextSlides as PresentationDocument["slides"],
  });

  return {
    ...demoProject,
    title: nextPresentation.title,
    presentation: {
      id: nextPresentation.id,
      document: nextPresentation,
    },
  };
}
