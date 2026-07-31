"use client";

import { useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, FileUp, GraduationCap, School, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { fadeSlideVariants, listItemVariants, transitions } from "@/components/motion/motion-presets";
import type { UsageSummary } from "@/lib/account-types";
import { canCreateProject } from "@/lib/account-types";
import { formatResetDate } from "@/lib/project-ui";
import { ApiClientError, apiJson } from "@/lib/project-queries";
import { RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS, getRussianStudentSpeechTimingBudget } from "@studydeck/shared";

const slideOptions = RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS.map((preset) => ({
  count: preset.slideCount,
  label: preset.label,
  description: preset.maxMinutes === undefined ? `от ${preset.minMinutes} минут` : `${preset.minMinutes}-${preset.maxMinutes} минут`,
}));

const projectTitleLimit = 140;
const studentGenerationBrief = {
  audience: "university_student",
  speechStyle: "easy_professional",
  slideDensity: "brief_slides_full_speech",
  visualStrategy: "images_and_diagrams",
  exportTarget: "web_and_pptx_pdf",
} as const;

export function NewProjectForm({ usage, maxSlides }: { usage: UsageSummary; maxSlides: number }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(10);
  const [volumeConfirmed, setVolumeConfirmed] = useState(false);
  const [sourceMode, setSourceMode] = useState<"web" | "files">("web");
  const [audience, setAudience] = useState<"school" | "university">("university");
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const normalizedTopic = topic.trim();
  const availableSlideOptions = slideOptions.filter((option) => option.count <= maxSlides);
  const creationAllowed = canCreateProject(usage);

  function nextFromTopic() {
    setError("");
    if (normalizedTopic.length < 2) {
      setError("Напиши тему презентации.");
      return;
    }
    setStep(1);
  }

  function updateFiles(fileList: FileList | null) {
    setFiles(Array.from(fileList || []));
    setError("");
  }

  function formatFileSize(size: number) {
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
    return `${(size / 1024 / 1024).toFixed(1)} МБ`;
  }

  async function createProjectDraft() {
    if (!creationAllowed) {
      setError(`Лимит исчерпан. Новую презентацию можно создать ${formatResetDate(usage)}.`);
      return;
    }
    if (sourceMode === "files" && !files.length) {
      setError("Добавь хотя бы один файл или выбери поиск источников в интернете.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const project = await apiJson<{ id: string }>("/api/projects", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          title: projectTitleFromTopic(normalizedTopic),
          prompt: studentPrompt(normalizedTopic, slideCount, audience),
          scenario: audience === "school" ? "school_report" : "university_report",
          level: audience === "school" ? "school" : "university_student",
          mode: sourceMode === "web" ? "with_sources" : "fast_draft",
          slideCount,
          generationBrief: { ...studentGenerationBrief, audience: audience === "school" ? "school_student" : "university_student" },
        })
      });

      if (sourceMode === "files" && files.length) {
        const uploadBody = new FormData();
        files.forEach((file) => uploadBody.append("files", file));
        await apiJson(`/api/projects/${project.id}/uploads`, { method: "POST", body: uploadBody });
      }

      router.push(`/projects/${project.id}/script`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Не получилось начать работу. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wizard panel new-workspace" aria-label="Создание презентации">
      {!creationAllowed ? <div className="usage-blocked" role="alert"><strong>Лимит на этот месяц исчерпан</strong><span>Создание снова откроется {formatResetDate(usage)}. Существующие презентации можно редактировать и экспортировать.</span><Link className="ghost" href="/projects">Открыть презентации</Link></div> : null}
      <nav className="wizard-progress" aria-label="Шаги создания презентации">
        {[
          { label: "Тема", complete: Boolean(normalizedTopic) },
          { label: "Объём", complete: volumeConfirmed },
          { label: "Источники", complete: false },
          { label: "Текст", complete: false },
          { label: "Слайды", complete: false },
          { label: "Экспорт", complete: false },
        ].map((item, index) => {
          const targetStep = index;
          const available = targetStep === 0 || targetStep === 1
            ? Boolean(normalizedTopic) || targetStep === 0
            : targetStep === 2 && volumeConfirmed;
          const active = step === targetStep;

          return (
            <motion.button
              className={`wizard-progress-step ${active ? "wizard-progress-step-active" : ""} ${item.complete ? "wizard-progress-step-complete" : ""}`}
              key={item.label}
              type="button"
              disabled={!available}
              aria-label={`Шаг ${index + 1}: ${item.label}`}
              aria-current={active ? "step" : undefined}
              onClick={() => targetStep <= 2 && setStep(targetStep)}
              layout
              transition={transitions.control}
            >
              <span>{item.complete ? <Check aria-hidden="true" size={14} strokeWidth={3} /> : index + 1}</span>
              <span className="wizard-progress-step-label">{item.label}</span>
            </motion.button>
          );
        })}
      </nav>

      <div className="wizard-main">
        <AnimatePresence initial={false} mode="wait">
        {step === 0 ? (
          <motion.div key="topic" className="wizard-pane wizard-pane-topic" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
            <div className="wizard-content">
              <label className="field">
                <span className="wizard-question">О чём будет презентация?</span>
                <textarea
                  className="textarea topic-input"
                  data-testid="new-project-topic"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Например: как AI меняет высшее образование"
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") nextFromTopic();
                  }}
                />
              </label>
              <fieldset className="audience-choice">
                <legend>Для какого уровня?</legend>
                <button className={audience === "school" ? "audience-option audience-option-active" : "audience-option"} type="button" aria-pressed={audience === "school"} onClick={() => setAudience("school")}><School size={19} /><span><strong>Школа</strong><small>Понятно и по возрасту</small></span></button>
                <button className={audience === "university" ? "audience-option audience-option-active" : "audience-option"} type="button" aria-pressed={audience === "university"} onClick={() => setAudience("university")}><GraduationCap size={19} /><span><strong>Вуз</strong><small>Академично, но ясно</small></span></button>
              </fieldset>
            </div>
            <div className="actions action-row">
              <button className="button" data-testid="new-project-next" type="button" onClick={nextFromTopic} disabled={!creationAllowed}>
                Продолжить
              </button>
            </div>
          </motion.div>
        ) : null}

        {step === 1 ? (
          <motion.div key="volume" className="wizard-pane wizard-pane-volume" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
            <div className="wizard-content">
              <div className="wizard-intro">
                <h2 className="wizard-question">Сколько слайдов собрать?</h2>
                <p className="muted">По умолчанию выбрали оптимальный объём для обычного выступления.</p>
              </div>
              <div className="slide-count-options" role="radiogroup" aria-label="Количество слайдов">
                {availableSlideOptions.map((option, index) => (
                  <button
                    className={`choice-button ${slideCount === option.count ? "choice-button-active" : ""}`}
                    key={option.count}
                    type="button"
                    role="radio"
                    aria-checked={slideCount === option.count}
                    onClick={() => setSlideCount(option.count)}
                    onKeyDown={(event) => focusRadioOption(event, index, availableSlideOptions.length, (nextIndex) => setSlideCount(availableSlideOptions[nextIndex].count))}
                  >
                    <strong>{option.count}</strong>
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="actions action-row">
              <button className="ghost" type="button" onClick={() => setStep(0)}>
                Назад
              </button>
              <button className="button" data-testid="new-project-next" type="button" onClick={() => { setVolumeConfirmed(true); setStep(2); }}>
                Продолжить
              </button>
            </div>
          </motion.div>
        ) : null}

        {step === 2 ? (
          <motion.div key="sources" className={`wizard-pane wizard-pane-sources ${sourceMode === "files" ? "wizard-pane-sources-files" : ""}`} variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
            <div className="wizard-content">
              <div className="wizard-intro">
                <h2 className="wizard-question">На что опираться?</h2>
                <p className="muted">Выбери способ собрать материал для презентации.</p>
              </div>
              <div className="source-choices" role="radiogroup" aria-label="Источник материала">
                <button
                  className={`source-choice ${sourceMode === "web" ? "source-choice-active" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={sourceMode === "web"}
                  onClick={() => {
                    setSourceMode("web");
                    setError("");
                  }}
                  onKeyDown={(event) => focusRadioOption(event, 0, 2, (nextIndex) => setSourceMode(nextIndex === 0 ? "web" : "files"))}
                >
                  <Search aria-hidden="true" size={20} />
                  <span>
                    <strong>Найти источники в интернете</strong>
                    <small>Быстрый вариант: подберём материалы по теме.</small>
                  </span>
                </button>
                <button
                  className={`source-choice ${sourceMode === "files" ? "source-choice-active" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={sourceMode === "files"}
                  onClick={() => {
                    setSourceMode("files");
                    setError("");
                  }}
                  onKeyDown={(event) => focusRadioOption(event, 1, 2, (nextIndex) => setSourceMode(nextIndex === 0 ? "web" : "files"))}
                >
                  <FileUp aria-hidden="true" size={20} />
                  <span>
                    <strong>Использовать мои материалы</strong>
                    <small>Конспект, задание или готовые источники.</small>
                  </span>
                </button>
              </div>
              <AnimatePresence initial={false} mode="popLayout">
              {sourceMode === "web" ? (
                <motion.div key="web-note" className="source-web-note" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit" layout="position">
                  <strong>Можно продолжать</strong>
                  <span>На следующем экране ты проверишь настройки и отдельно подтвердишь запуск AI-поиска и подготовки текста.</span>
                </motion.div>
              ) : null}
              {sourceMode === "files" ? (
                <motion.div key="file-source" className="source-file-panel" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit" layout="position">
                  <label
                    className={`dropzone ${dragActive ? "dropzone-active" : ""}`}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      updateFiles(event.dataTransfer.files);
                    }}
                  >
                    <input
                      className="file-input"
                      type="file"
                      accept=".pdf,.docx,.pptx,.txt,.md,.csv"
                      multiple
                      onChange={(event) => updateFiles(event.target.files)}
                    />
                    <span>Перетащи PDF, DOCX, PPTX или TXT</span>
                    <small>Или нажми, чтобы выбрать файлы на устройстве.</small>
                  </label>
                  {files.length ? (
                    <motion.div className="source-list" aria-label="Выбранные файлы" initial="hidden" animate="visible">
                      <AnimatePresence initial={false} mode="popLayout">
                      {files.map((file, index) => (
                        <motion.div className="source-item" key={`${file.name}-${file.size}`} custom={index} variants={listItemVariants} initial="hidden" animate="visible" exit="exit" layout="position">
                          <div><strong>{file.name}</strong><span>{formatFileSize(file.size)}</span></div>
                          <button
                            type="button"
                            className="source-remove"
                            aria-label={`Удалить файл ${file.name}`}
                            onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                          ><X aria-hidden="true" size={17} /></button>
                        </motion.div>
                      ))}
                      </AnimatePresence>
                    </motion.div>
                  ) : (
                    <p className="source-file-hint">Добавь хотя бы один файл, чтобы продолжить с собственными материалами.</p>
                  )}
                </motion.div>
              ) : null}
              </AnimatePresence>
            </div>
            <div className="actions action-row">
              <button className="ghost" type="button" onClick={() => setStep(1)} disabled={busy}>
                Назад
              </button>
              <button className="button" data-testid="new-project-next" type="button" onClick={createProjectDraft} disabled={busy || !creationAllowed || (sourceMode === "files" && !files.length)}>
                {busy ? "Сохраняем проект..." : "Сохранить и проверить настройки"}
              </button>
            </div>
            <p className="generation-safety-note">На этом шаге AI не запускается и баланс провайдера не расходуется.</p>
          </motion.div>
        ) : null}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {error ? <motion.p className="form-error" role="alert" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">{error}</motion.p> : null}
        </AnimatePresence>
      </div>
    </section>
  );
}

function focusRadioOption(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  count: number,
  onSelect: (index: number) => void,
) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
  const nextIndex = (index + direction + count) % count;
  onSelect(nextIndex);
  const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  radios?.[nextIndex]?.focus();
}

function projectTitleFromTopic(topic: string) {
  const normalized = topic.replace(/\s+/g, " ").trim();
  if (normalized.length <= projectTitleLimit) return normalized;
  return `${normalized.slice(0, projectTitleLimit - 3).trimEnd()}...`;
}

export function studentPrompt(topic: string, slideCount: number, audience: "school" | "university") {
  const audienceCopy = audience === "school"
    ? "школьную презентацию с понятными формулировками, подходящими для выступления перед классом"
    : "академическую, но лёгкую для устного выступления студенческую презентацию";
  const timingBudget = audience === "university"
    ? getRussianStudentSpeechTimingBudget({ slideCount, level: "university_student", mode: "with_sources" })
    : null;
  return [
    `Подготовь ${audienceCopy} на ${slideCount} слайдов по теме: ${topic}.`,
    timingBudget
      ? `Длительность выступления: ${timingBudget.minMinutes}${timingBudget.maxMinutes === undefined ? "+" : `-${timingBudget.maxMinutes}`} минут; ориентир ${timingBudget.targetWords} слов при ${timingBudget.wordsPerMinute} словах в минуту.`
      : "",
    "Слайды должны быть короткими и визуально аккуратными: один сильный тезис, минимум текста, изображения, схемы или диаграммы там, где они помогают объяснению.",
    audience === "school" ? "Основное объяснение перенеси в заметки докладчика: текст должен звучать естественно для школьника." : "Основное объяснение перенеси в заметки докладчика: текст должен звучать профессионально и естественно для студента.",
    "Результат должен одинаково хорошо смотреться в веб-превью и в экспорте PPTX/PDF.",
  ].join(" ");
}
