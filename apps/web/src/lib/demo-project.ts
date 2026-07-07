import { ensureEditableCanvas, type PresentationDocument, type SlideBlock, type SlideCanvas } from "@studydeck/shared";

const source = {
  id: "src-demo",
  label: "Пример проекта",
  type: "DEMO",
  excerpt:
    "Этот проект показывает редактор, заметки докладчика и готовый текст выступления.",
};

const slides: any[] = [
  {
    id: "slide-1",
    order: 1,
    title: "StudyDeck AI помогает подготовиться к выступлению",
    layout: "hero",
    blocks: [
      {
        type: "callout",
        content: "Добавь тему и материалы, проверь текст, а затем собери из него слайды.",
      },
    ],
    speakerNotes:
      "Сначала расскажу о знакомой ситуации: презентацию нужно сдать скоро, но материала много и непонятно, с чего начать.",
    timingSeconds: 45,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
  {
    id: "slide-2",
    order: 2,
    title: "Когда пригодится StudyDeck",
    layout: "bullets",
    blocks: [
      {
        type: "callout",
        content: "StudyDeck пригодится для доклада на паре, семинара или защиты проекта.",
      },
    ],
    speakerNotes:
      "Здесь важно объяснить: сервис не просто оформляет слайды. Он помогает разобраться в материале и выстроить рассказ.",
    timingSeconds: 55,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
  {
    id: "slide-3",
    order: 3,
    title: "Рабочий процесс",
    layout: "process",
    thesis: "Работа идёт по шагам, поэтому ничего не теряется по дороге.",
    bullets: [
      "Ты задаёшь тему и добавляешь материалы",
      "StudyDeck готовит текст и собирает слайды",
      "Ты проверяешь работу и скачиваешь готовый файл",
    ],
    visual: {
      type: "process_diagram",
      title: "",
      description: "Учебный процесс от темы и материалов до готовой презентации",
      leftLabel: "",
      rightLabel: "",
      items: [
        { label: "Добавить тему", text: "Напиши задание и приложи материалы, если они есть." },
        { label: "Проверить текст", text: "Прочитай черновик выступления и поправь его под себя." },
        { label: "Скачать работу", text: "Проверь слайды и сохрани презентацию в PDF или PPTX." },
      ],
      rows: [],
    },
    blocks: [
      {
        type: "callout",
        content: "Тема, текст, слайды и готовые файлы остаются в одном проекте.",
      },
    ],
    speakerNotes:
      "Покажу весь путь по порядку: тема, текст выступления, слайды и готовый файл.",
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
        content: "В редакторе можно поправить текст, заменить изображение и изменить расположение объектов.",
      },
    ],
    speakerNotes:
      "На одном экране видны и слайды, и текст выступления. Так проще заметить неточную формулировку до скачивания.",
    timingSeconds: 55,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
  {
    id: "slide-5",
    order: 5,
    title: "Готово к выступлению",
    layout: "summary",
    blocks: [
      {
        type: "callout",
        content: "Скачай презентацию в PDF или PPTX. Если позже заметишь ошибку, вернись в проект и поправь её.",
      },
    ],
    speakerNotes:
      "В конце напомню: перед выступлением стоит ещё раз открыть заметки и проговорить текст вслух.",
    timingSeconds: 45,
    sourceRefs: [{ sourceId: source.id, label: source.label, excerpt: source.excerpt, page: null }],
  },
];

export const demoPresentation: PresentationDocument = ensureEditableCanvas({
  id: "presentation-demo",
  title: "Как StudyDeck помогает подготовиться к выступлению",
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

export function updateDemoSlide(slideId: string, input: { title?: string; thesis?: string; bullets?: string[]; blocks?: SlideBlock[]; canvas?: SlideCanvas; speakerNotes?: string }) {
  const nextSlides = demoPresentation.slides.map((slide) =>
    slide.id === slideId
      ? {
          ...slide,
          title: input.title ?? slide.title,
          thesis: input.thesis ?? slide.thesis,
          bullets: input.bullets ?? slide.bullets,
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
