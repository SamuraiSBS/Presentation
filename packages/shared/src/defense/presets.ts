import { z } from "zod";
import {
  authorProfileFieldSchema,
  defensePresetVersionSchema,
  defenseTypeSchema,
  projectRequirementSchema,
  requirementPrioritySchema,
  requirementRuleSchema,
  sourceRoleSchema,
} from "./schemas.js";
import type { DefensePresetVersion, DefenseType, ProjectRequirement } from "./schemas.js";

export const defensePresetSlideSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    order: z.number().int().min(1).max(20),
    title: z.string().trim().min(1).max(160),
    purpose: z.string().trim().min(1).max(600),
    timingSeconds: z.number().int().min(20).max(240),
    requiredAuthorFields: z.array(authorProfileFieldSchema).max(12).default([]),
    suggestedAssetRoles: z.array(sourceRoleSchema).max(12).default([]),
    visualStrategy: z.string().trim().max(600).default(""),
  })
  .strict();
export type DefensePresetSlide = z.infer<typeof defensePresetSlideSchema>;

export const defensePresetRequirementTemplateSchema = z
  .object({
    key: z.string().trim().min(1).max(240),
    text: z.string().trim().min(1).max(2_000),
    priority: requirementPrioritySchema,
    rule: requirementRuleSchema,
  })
  .strict();
export type DefensePresetRequirementTemplate = z.infer<typeof defensePresetRequirementTemplateSchema>;

export const defensePresetSchema = z
  .object({
    version: defensePresetVersionSchema,
    defenseType: defenseTypeSchema,
    language: z.literal("ru"),
    targetSlideCount: z.number().int().min(4).max(20),
    targetDurationSeconds: z.number().int().min(60).max(900),
    slides: z.array(defensePresetSlideSchema).min(4).max(20),
    requirements: z.array(defensePresetRequirementTemplateSchema).min(1).max(100),
  })
  .strict()
  .superRefine((preset, context) => {
    if (!preset.version.startsWith(`${preset.defenseType}-`)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["version"], message: "Preset must match defense type" });
    }
    if (preset.slides.length !== preset.targetSlideCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slides"],
        message: "Preset slide count must equal targetSlideCount",
      });
    }
    const orders = preset.slides.map((slide) => slide.order);
    if (orders.some((order, index) => order !== index + 1)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides"], message: "Preset slide order must be contiguous" });
    }
    const slideKeys = preset.slides.map((slide) => slide.key);
    const requirementKeys = preset.requirements.map((requirement) => requirement.key);
    if (new Set(slideKeys).size !== slideKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["slides"], message: "Preset slide keys must be unique" });
    }
    if (new Set(requirementKeys).size !== requirementKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["requirements"], message: "Preset requirement keys must be unique" });
    }
    const totalTiming = preset.slides.reduce((total, slide) => total + slide.timingSeconds, 0);
    if (totalTiming !== preset.targetDurationSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetDurationSeconds"],
        message: "Preset duration must equal the sum of slide timings",
      });
    }
  });
export type DefensePreset = z.infer<typeof defensePresetSchema>;

function slidePositionRequirements(slides: DefensePresetSlide[]): DefensePresetRequirementTemplate[] {
  return slides.map((slide) => ({
    key: `slide-position-${slide.key}`,
    text: `Слайд ${slide.order} должен раскрывать раздел «${slide.title}».`,
    priority: "required" as const,
    rule: {
      kind: "slide_position" as const,
      position: "exact" as const,
      order: slide.order,
      purposeKey: slide.key,
    },
  }));
}

const hackathonSlides: DefensePresetSlide[] = [
  {
    key: "title-team",
    order: 1,
    title: "Название проекта и команда",
    purpose: "Представить проект, автора или команду без неподтверждённых заявлений.",
    timingSeconds: 25,
    requiredAuthorFields: ["fullName", "teamName", "eventName"],
    suggestedAssetRoles: ["logo"],
    visualStrategy: "Титульная композиция с логотипом проекта или явным заполнителем.",
  },
  {
    key: "problem",
    order: 2,
    title: "Проблема",
    purpose: "Объяснить подтверждённую материалами проблему, которую решает проект.",
    timingSeconds: 45,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["supporting_image"],
    visualStrategy: "Одна формулировка проблемы и доказательная иллюстрация при наличии.",
  },
  {
    key: "audience",
    order: 3,
    title: "Целевая аудитория",
    purpose: "Назвать только подтверждённые группы пользователей и их задачи.",
    timingSeconds: 40,
    requiredAuthorFields: [],
    suggestedAssetRoles: [],
    visualStrategy: "Короткие сегменты аудитории без вымышленных метрик.",
  },
  {
    key: "solution",
    order: 4,
    title: "Решение",
    purpose: "Показать, как проект отвечает на заявленную проблему.",
    timingSeconds: 50,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["screenshot"],
    visualStrategy: "Связка проблема — решение с пользовательским материалом.",
  },
  {
    key: "features",
    order: 5,
    title: "Ключевые функции",
    purpose: "Перечислить подтверждённые функции проекта.",
    timingSeconds: 55,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["screenshot"],
    visualStrategy: "До трёх функций с соответствующими скриншотами или заполнителями.",
  },
  {
    key: "interface-demo",
    order: 6,
    title: "Демонстрация интерфейса",
    purpose: "Показать реальный интерфейс проекта, не заменяя его интернет-изображением.",
    timingSeconds: 65,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["screenshot"],
    visualStrategy: "Крупный пользовательский скриншот; при отсутствии — явный заполнитель.",
  },
  {
    key: "technology-stack",
    order: 7,
    title: "Технологический стек",
    purpose: "Назвать только технологии, подтверждённые источником или автором.",
    timingSeconds: 45,
    requiredAuthorFields: [],
    suggestedAssetRoles: [],
    visualStrategy: "Компактная схема стека без вывода технологий из исходного кода.",
  },
  {
    key: "architecture",
    order: 8,
    title: "Архитектура или принцип работы",
    purpose: "Объяснить подтверждённую архитектуру или общий принцип работы.",
    timingSeconds: 45,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["supporting_image"],
    visualStrategy: "Диаграмма только по подтверждённым связям; иначе заполнитель.",
  },
  {
    key: "results-roadmap",
    order: 9,
    title: "Результаты и дальнейшее развитие",
    purpose: "Отделить подтверждённые результаты от явно обозначенных планов.",
    timingSeconds: 30,
    requiredAuthorFields: [],
    suggestedAssetRoles: [],
    visualStrategy: "Две зоны: достигнуто и следующий шаг, без вымышленных метрик.",
  },
  {
    key: "closing-contacts",
    order: 10,
    title: "Завершение и контакты",
    purpose: "Кратко завершить защиту и показать подтверждённые контакты при наличии.",
    timingSeconds: 20,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["logo"],
    visualStrategy: "Чистый финальный слайд с названием проекта.",
  },
];

const diplomaSlides: DefensePresetSlide[] = [
  {
    key: "title",
    order: 1,
    title: "Титульный слайд",
    purpose: "Показать тему работы и стандартные данные автора.",
    timingSeconds: 30,
    requiredAuthorFields: ["fullName", "institution", "department", "group", "supervisor", "city", "year"],
    suggestedAssetRoles: ["logo"],
    visualStrategy: "Академичный титульный слайд с заполнителями для отсутствующих данных.",
  },
  {
    key: "relevance",
    order: 2,
    title: "Актуальность",
    purpose: "Обосновать актуальность только на основе подтверждённых материалов.",
    timingSeconds: 45,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["supporting_image"],
    visualStrategy: "Один аргумент актуальности и источник во внутреннем provenance.",
  },
  {
    key: "goal-tasks",
    order: 3,
    title: "Цель и задачи",
    purpose: "Сформулировать подтверждённую цель и задачи работы.",
    timingSeconds: 55,
    requiredAuthorFields: [],
    suggestedAssetRoles: [],
    visualStrategy: "Цель как главный тезис, задачи как последовательность.",
  },
  {
    key: "object-subject",
    order: 4,
    title: "Объект и предмет работы",
    purpose: "Назвать объект и предмет работы либо показать явные заполнители.",
    timingSeconds: 45,
    requiredAuthorFields: [],
    suggestedAssetRoles: [],
    visualStrategy: "Сопоставление объекта и предмета без домыслов.",
  },
  {
    key: "system-requirements",
    order: 5,
    title: "Требования к системе",
    purpose: "Показать подтверждённые функциональные и нефункциональные требования.",
    timingSeconds: 50,
    requiredAuthorFields: [],
    suggestedAssetRoles: [],
    visualStrategy: "Структурированный список требований с приоритетами.",
  },
  {
    key: "architecture",
    order: 6,
    title: "Архитектура",
    purpose: "Объяснить подтверждённую архитектуру системы.",
    timingSeconds: 55,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["supporting_image"],
    visualStrategy: "Диаграмма подтверждённых компонентов и связей; иначе заполнитель.",
  },
  {
    key: "technologies",
    order: 7,
    title: "Использованные технологии",
    purpose: "Назвать только подтверждённые автором или документацией технологии.",
    timingSeconds: 50,
    requiredAuthorFields: [],
    suggestedAssetRoles: [],
    visualStrategy: "Компактная карта технологий без анализа исходного кода.",
  },
  {
    key: "implementation",
    order: 8,
    title: "Реализация основных функций",
    purpose: "Показать реализацию подтверждённых ключевых функций.",
    timingSeconds: 65,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["screenshot"],
    visualStrategy: "Функции и пользовательские скриншоты; отсутствие отмечается заполнителем.",
  },
  {
    key: "interface-demo",
    order: 9,
    title: "Интерфейс и демонстрация",
    purpose: "Показать реальный интерфейс и сценарий использования проекта.",
    timingSeconds: 65,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["screenshot"],
    visualStrategy: "Крупные пользовательские скриншоты, не заменяемые стоковыми изображениями.",
  },
  {
    key: "testing-results",
    order: 10,
    title: "Тестирование и результаты",
    purpose: "Показать только подтверждённые методы тестирования и результаты.",
    timingSeconds: 55,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["supporting_image"],
    visualStrategy: "Результаты или явные заполнители вместо вымышленных метрик.",
  },
  {
    key: "conclusions",
    order: 11,
    title: "Выводы",
    purpose: "Связать подтверждённые результаты с целью и задачами.",
    timingSeconds: 50,
    requiredAuthorFields: [],
    suggestedAssetRoles: [],
    visualStrategy: "Короткие выводы без новых фактов.",
  },
  {
    key: "closing",
    order: 12,
    title: "Завершающий слайд",
    purpose: "Завершить выступление без автоматически сгенерированных вопросов жюри.",
    timingSeconds: 35,
    requiredAuthorFields: [],
    suggestedAssetRoles: ["logo"],
    visualStrategy: "Спокойный финальный слайд с темой работы.",
  },
];

function commonRequirements(
  slides: DefensePresetSlide[],
  durationSeconds: number,
): DefensePresetRequirementTemplate[] {
  return [
    {
      key: "exact-slide-count",
      text: `Презентация должна содержать ${slides.length} слайдов.`,
      priority: "required",
      rule: { kind: "slide_count", exact: slides.length },
    },
    ...slidePositionRequirements(slides),
    {
      key: "total-timing",
      text: `Общая длительность выступления не должна превышать ${Math.round(durationSeconds / 60)} минут.`,
      priority: "required",
      rule: { kind: "timing", scope: "total", maxSeconds: durationSeconds },
    },
    {
      key: "speaker-notes",
      text: "Для каждого слайда нужен полный текст выступления.",
      priority: "required",
      rule: { kind: "speaker_notes" },
    },
  ].map((requirement) => defensePresetRequirementTemplateSchema.parse(requirement));
}

function authorRequirements(
  fields: readonly z.infer<typeof authorProfileFieldSchema>[],
  priority: z.infer<typeof requirementPrioritySchema>,
): DefensePresetRequirementTemplate[] {
  const labels: Record<z.infer<typeof authorProfileFieldSchema>, string> = {
    fullName: "ФИО автора",
    institution: "учебное заведение",
    department: "кафедру",
    group: "группу",
    supervisor: "руководителя",
    city: "город",
    year: "год защиты",
    teamName: "название команды",
    eventName: "название мероприятия",
  };
  return fields.map((field) => ({
    key: `author-${field}`,
    text: `На титульном слайде нужно указать ${labels[field]}.`,
    priority,
    rule: { kind: "author_field" as const, field },
  }));
}

const parsedHackathonPreset = defensePresetSchema.parse({
  version: "hackathon-v1",
  defenseType: "hackathon",
  language: "ru",
  targetSlideCount: 10,
  targetDurationSeconds: 420,
  slides: hackathonSlides,
  requirements: [
    ...commonRequirements(hackathonSlides, 420),
    ...authorRequirements(["fullName", "teamName"], "recommended"),
    ...authorRequirements(["eventName"], "preference"),
  ],
});

const parsedDiplomaPreset = defensePresetSchema.parse({
  version: "diploma-v1",
  defenseType: "diploma",
  language: "ru",
  targetSlideCount: 12,
  targetDurationSeconds: 600,
  slides: diplomaSlides,
  requirements: [
    ...commonRequirements(diplomaSlides, 600),
    ...authorRequirements(["fullName", "institution", "department", "group", "supervisor", "city", "year"], "required"),
  ],
});

export const DEFENSE_PRESETS: Readonly<Record<DefensePresetVersion, DefensePreset>> = Object.freeze({
  "hackathon-v1": parsedHackathonPreset,
  "diploma-v1": parsedDiplomaPreset,
});

export const DEFAULT_DEFENSE_PRESET_BY_TYPE: Readonly<Record<DefenseType, DefensePresetVersion>> = Object.freeze({
  hackathon: "hackathon-v1",
  diploma: "diploma-v1",
});

function clonePreset(preset: DefensePreset): DefensePreset {
  return defensePresetSchema.parse(JSON.parse(JSON.stringify(preset)));
}

export function getDefensePreset(typeOrVersion: DefenseType | DefensePresetVersion): DefensePreset {
  const parsedVersion = defensePresetVersionSchema.safeParse(typeOrVersion);
  const version = parsedVersion.success
    ? parsedVersion.data
    : DEFAULT_DEFENSE_PRESET_BY_TYPE[defenseTypeSchema.parse(typeOrVersion)];
  return clonePreset(DEFENSE_PRESETS[version]);
}

export function materializeDefensePresetRequirements(version: DefensePresetVersion): ProjectRequirement[] {
  const preset = getDefensePreset(version);
  return preset.requirements.map((requirement) =>
    projectRequirementSchema.parse({
      id: `builtin:${version}:${requirement.key}`,
      key: requirement.key,
      text: requirement.text,
      priority: requirement.priority,
      origin: "builtin",
      state: "active",
      rule: requirement.rule,
      presetVersion: version,
    }),
  );
}
