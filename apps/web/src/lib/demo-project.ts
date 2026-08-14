import { ensureEditableCanvas, type PresentationDocument, type SlideBlock, type SlideCanvas } from "@studydeck/shared";
import type { DefenseWorkspacePayload } from "@/lib/defense-queries";

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
  accessRole: "owner" as const,
  presentationRevision: 1,
  sources: demoPresentation.sources,
  exports: [],
  presentation: {
    id: demoPresentation.id,
    document: demoPresentation,
  },
};

const demoDefenseSource = {
  id: "src-defense-brief",
  label: "Бриф учебного проекта",
  type: "FILE",
  excerpt: "MVP помогает студенту подготовить структуру выступления, слайды и текст доклада.",
  included: true,
  role: "defense_spec" as const,
  metadata: {
    origin: "upload" as const,
    originalFileName: "project-brief.pdf",
    mimeType: "application/pdf",
    locator: "стр. 2",
    chunks: [],
    warnings: [],
  },
};

const demoDefensePlanSlides = [
  ["defense-plan-1", "Проблема и цель", "Сформулировать задачу учебного проекта"],
  ["defense-plan-2", "Решение", "Показать ключевые возможности StudyDeck"],
  ["defense-plan-3", "Проверка результата", "Связать факты и требования с демонстрацией"],
  ["defense-plan-4", "Вывод", "Подвести итог и обозначить следующий шаг"],
] as const;

export const demoDefenseProject = {
  ...demoProject,
  id: "defense-demo",
  title: "Защита учебного проекта StudyDeck",
  workflow: "requirements_driven" as const,
};

export const demoDefenseWorkspace: DefenseWorkspacePayload = {
  workspace: {
    id: "workspace-defense-demo",
    projectId: demoDefenseProject.id,
    defenseType: "hackathon",
    complianceMode: "strict",
    language: "ru",
    targetSlideCount: 4,
    targetDurationSeconds: 300,
    allowWebImages: false,
    authorProfile: { teamName: "StudyDeck demo", eventName: "Учебная защита" },
    standardPresetVersion: "hackathon-v1",
    analysisStatus: "review_ready",
    analysisRevision: 1,
    planRevision: 1,
    styleBrief: null,
    analysisError: null,
    plan: {
      version: 1,
      defenseType: "hackathon",
      complianceMode: "strict",
      presetVersion: "hackathon-v1",
      status: "draft",
      slides: demoDefensePlanSlides.map(([id, title, purpose], index) => ({
        id,
        order: index + 1,
        title,
        purpose,
        timingSeconds: 60,
        requirementIds: index === 0 ? ["requirement-defense-brief"] : [],
        factIds: index === 1 ? ["fact-defense-mvp"] : [],
        assetSourceIds: index === 1 ? [demoDefenseSource.id] : [],
        placeholders: [],
        visualStrategy: index === 1 ? "Показать краткую схему сценария работы" : "",
        origin: "user",
      })),
      totalTimingSeconds: 240,
      approvedAt: null,
    },
    facts: [],
    requirements: [],
    conflicts: [],
    assets: [],
    createdAt: "2026-08-12T12:00:00.000Z",
    updatedAt: "2026-08-12T12:00:00.000Z",
  },
  sources: [demoDefenseSource],
  facts: [
    {
      id: "fact-defense-mvp",
      workspaceId: "workspace-defense-demo",
      key: "mvp-purpose",
      statement: "MVP объединяет подготовку структуры, слайдов и текста выступления в одном проекте.",
      state: "active",
      evidence: [{ confirmation: "source", sourceId: demoDefenseSource.id, locator: "стр. 2", excerpt: demoDefenseSource.excerpt }],
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    },
  ],
  requirements: [
    {
      id: "requirement-defense-brief",
      workspaceId: "workspace-defense-demo",
      key: "demo-slide-count",
      text: "В защите должны быть цель, решение, подтверждённый результат и вывод.",
      priority: "required",
      origin: "source",
      sourceId: demoDefenseSource.id,
      locator: "стр. 2",
      excerpt: demoDefenseSource.excerpt,
      state: "active",
      rule: { kind: "slide_count", exact: 4 },
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    },
  ],
  conflicts: [],
  reports: [],
  jobs: [],
  presentationRevision: 1,
  accessRole: "owner",
};

const scriptReviewSources = Array.from({ length: 6 }, (_, index) => ({
  id: `src-script-review-${index + 1}`,
  label: `Материал для раздела ${index + 1}`,
  type: index % 2 === 0 ? "WEB" : "FILE",
  excerpt: `Краткий фрагмент источника ${index + 1}. Он нужен только после явного раскрытия, чтобы не перегружать страницу проверки речи.`,
  ...(index % 2 === 0 ? { url: `https://example.com/source-${index + 1}` } : {}),
}));

const scriptReviewDraft = Array.from({ length: 14 }, (_, index) => {
  const order = index + 1;
  return `Слайд ${order}: Раздел ${order}\nВ этом разделе раскрывается ключевая мысль слайда ${order}. Текст оставлен достаточно длинным для проверки навигации, сохранения и прогрессивного раскрытия на мобильном экране.`;
}).join("\n\n");

/** A demo-only long script used by deterministic responsive review tests. */
export const demoScriptReviewProject = {
  id: "script-review-demo",
  title: "Проверка длинного текста выступления",
  status: "script_ready" as const,
  narrationState: "editable_draft" as const,
  slideCount: 14,
  updatedAt: new Date("2026-07-31T12:00:00.000Z").toISOString(),
  accessRole: "owner" as const,
  presentationRevision: 1,
  speechDraft: scriptReviewDraft,
  sources: scriptReviewSources,
  exports: [],
  presentation: null,
};

const demoUser = {
  id: "demo-user",
  name: "Учебный пример",
  image: null,
};

export const demoUsage = {
  planCode: "free" as const,
  period: "2026-07",
  limit: 10,
  used: 1,
  remaining: 9,
  resetsAt: "2026-08-01T00:00:00.000Z",
  exhausted: false,
  canCreate: true,
};

const demoProjectSummary = {
  id: demoProject.id,
  title: demoProject.title,
  status: "ready" as const,
  slideCount: demoProject.slideCount,
  updatedAt: demoProject.updatedAt,
  createdAt: "2026-06-12T10:00:00.000Z",
  error: null,
  accessRole: "owner" as const,
  owner: demoUser,
  folder: null,
  hasPresentation: true,
  latestExport: null,
  memberCount: 1,
};

export const demoDashboard = {
  user: {
    ...demoUser,
    telegramUsername: null,
    planCode: "free" as const,
  },
  usage: demoUsage,
  stats: {
    presentationsCreated: 1,
    slidesCreated: demoProject.slideCount,
    readyPresentations: 1,
    savedHoursMin: 1,
    savedHoursMax: 2,
  },
  recentProjects: [demoProjectSummary],
  activeProjects: [],
  attentionProjects: [],
  sharedProjects: [],
};

export const demoProjectList = {
  items: [demoProjectSummary],
  nextCursor: null,
  usage: demoUsage,
};

export const demoFolders = { items: [] };

export const demoProfile = {
  ...demoUser,
  telegramUsername: null,
  telegramId: null,
  createdAt: "2026-06-12T10:00:00.000Z",
  planCode: "free" as const,
  usage: demoUsage,
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
