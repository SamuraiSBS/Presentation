"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, FileUp, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { fadeSlideVariants, listItemVariants, transitions } from "@/components/motion/motion-presets";
import type { UsageSummary } from "@/lib/account-types";
import {
  clearNewProjectDraft,
  createNewProjectIdempotencyKey,
  readNewProjectDraft,
  writeNewProjectDraft,
  type NewProjectCreationPhase,
} from "@/lib/new-project-draft";
import { ApiClientError, apiJson } from "@/lib/project-queries";
import { RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS, getRussianStudentSpeechTimingBudget } from "@studydeck/shared";

const slideOptions = RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS.map((preset) => ({
  count: preset.slideCount,
  label: preset.label,
  description: preset.maxMinutes === undefined ? `от ${preset.minMinutes} минут` : `${preset.minMinutes}-${preset.maxMinutes} минут`,
}));

const projectTitleLimit = 140;
const studentGenerationBrief = {
  audience: "general",
  speechStyle: "easy_professional",
  slideDensity: "brief_slides_full_speech",
  visualStrategy: "images_and_diagrams",
  exportTarget: "web_and_pptx_pdf",
} as const;

export function NewProjectForm({ usage }: { usage: UsageSummary }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(() => usage.allowedSlideCounts.includes(10) ? 10 : usage.allowedSlideCounts.at(-1) || 6);
  const [volumeConfirmed, setVolumeConfirmed] = useState(false);
  const [sourceMode, setSourceMode] = useState<"web" | "files">("web");
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [phase, setPhase] = useState<NewProjectCreationPhase>("draft");
  const [draftReady, setDraftReady] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const progressRef = useRef<HTMLElement>(null);

  const normalizedTopic = topic.trim();
  const availableSlideOptions = slideOptions.filter((option) => usage.allowedSlideCounts.includes(option.count));

  useEffect(() => {
    const draft = readNewProjectDraft();
    if (draft) {
      setRestoredDraft(true);
      setStep(draft.step);
      setTopic(draft.topic);
      setSlideCount(usage.allowedSlideCounts.includes(draft.slideCount) ? draft.slideCount : usage.allowedSlideCounts.at(-1) || 6);
      setVolumeConfirmed(draft.volumeConfirmed);
      setSourceMode(draft.sourceMode);
      setProjectId(draft.projectId);
      setIdempotencyKey(draft.idempotencyKey);
      setPhase(draft.phase);
    } else {
      setIdempotencyKey(createNewProjectIdempotencyKey());
    }
    setDraftReady(true);
  }, [usage.allowedSlideCounts]);

  useEffect(() => {
    if (!draftReady || !idempotencyKey) return;
    writeNewProjectDraft({
      version: 1,
      step,
      topic,
      slideCount,
      volumeConfirmed,
      sourceMode,
      projectId,
      idempotencyKey,
      phase,
    });
  }, [draftReady, idempotencyKey, phase, projectId, slideCount, sourceMode, step, topic, volumeConfirmed]);

  useEffect(() => {
    const progress = progressRef.current;
    const activeStep = progress?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!progress || !activeStep) return;

    const stepLeft = activeStep.offsetLeft;
    const stepRight = stepLeft + activeStep.offsetWidth;
    if (stepLeft < progress.scrollLeft || stepRight > progress.scrollLeft + progress.clientWidth) {
      progress.scrollTo({
        left: Math.max(0, stepLeft - (progress.clientWidth - activeStep.offsetWidth) / 2),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }, [step]);

  function persistDraft(overrides: Partial<{
    step: number;
    projectId: string | null;
    phase: NewProjectCreationPhase;
  }> = {}) {
    if (!idempotencyKey) return;
    writeNewProjectDraft({
      version: 1,
      step,
      topic,
      slideCount,
      volumeConfirmed,
      sourceMode,
      projectId,
      idempotencyKey,
      phase,
      ...overrides,
    });
  }

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

  async function uploadProject(targetProjectId: string) {
    if (!files.length) {
      setError("Проект уже создан. Выбери файлы заново, чтобы повторить только загрузку.");
      return false;
    }

    setPhase("uploading");
    persistDraft({ projectId: targetProjectId, phase: "uploading" });

    try {
      const uploadBody = new FormData();
      files.forEach((file) => uploadBody.append("files", file));
      await apiJson(`/api/projects/${targetProjectId}/uploads`, { method: "POST", body: uploadBody });
      setPhase("uploaded");
      persistDraft({ projectId: targetProjectId, phase: "uploaded" });
      return true;
    } catch (err) {
      setPhase("upload_failed");
      persistDraft({ projectId: targetProjectId, phase: "upload_failed" });
      setError(err instanceof ApiClientError
        ? `Проект создан, но файл не загрузился: ${err.message}`
        : "Проект создан, но файл не загрузился. Выбери файлы и повтори только загрузку.");
      return false;
    }
  }

  async function startNarration(targetProjectId: string) {
    setPhase("narration");
    persistDraft({ projectId: targetProjectId, phase: "narration" });

    try {
      await apiJson(`/api/projects/${targetProjectId}/narration`, { method: "POST" });
      clearNewProjectDraft();
      router.push(`/projects/${targetProjectId}/script`);
    } catch (err) {
      setPhase("narration_failed");
      persistDraft({ projectId: targetProjectId, phase: "narration_failed" });
      setError(err instanceof ApiClientError
        ? `Проект создан, но подготовку текста не удалось запустить: ${err.message}`
        : "Проект создан, но подготовку текста не удалось запустить. Повтори запуск ниже.");
    }
  }

  async function retryNarration(targetProjectId: string) {
    setBusy(true);
    setError("");
    try {
      await startNarration(targetProjectId);
    } finally {
      setBusy(false);
    }
  }

  async function createProjectDraft() {
    if (sourceMode === "files" && !files.length) {
      setError(projectId
        ? "Проект уже создан. Выбери файлы заново, чтобы повторить только загрузку."
        : "Добавь хотя бы один файл или выбери поиск источников в интернете.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      if (projectId) {
        if (sourceMode === "files") {
          if (await uploadProject(projectId)) await startNarration(projectId);
        } else {
          await startNarration(projectId);
        }
        return;
      }

      const project = await apiJson<{ id: string }>("/api/projects", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          title: projectTitleFromTopic(normalizedTopic),
          prompt: studentPrompt(normalizedTopic, slideCount),
          scenario: "general",
          level: "general",
          mode: sourceMode === "web" ? "with_sources" : "fast_draft",
          slideCount,
          generationBrief: studentGenerationBrief,
          idempotencyKey,
        })
      });

      setProjectId(project.id);
      setPhase("project_created");
      persistDraft({ projectId: project.id, phase: "project_created" });

      if (sourceMode === "files") {
        if (await uploadProject(project.id)) await startNarration(project.id);
      } else {
        await startNarration(project.id);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? `Проект ещё не создан: ${err.message}` : "Проект ещё не создан. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  const narrationRecoverable = Boolean(
    projectId && (
      phase === "narration" ||
      phase === "narration_failed" ||
      phase === "uploaded" ||
      (sourceMode === "web" && phase === "project_created")
    ),
  );
  const narrationProjectId = narrationRecoverable ? projectId : null;
  const uploadRecovery = Boolean(
    projectId && sourceMode === "files" && ["project_created", "uploading", "upload_failed"].includes(phase),
  );
  const filesNeedReselection = restoredDraft && sourceMode === "files" && !files.length;

  return (
    <section className="wizard panel new-workspace" aria-label="Создание презентации">
      <nav ref={progressRef} className="wizard-progress" aria-label="Шаги создания презентации">
        {[
          { label: "Тема", complete: Boolean(normalizedTopic) },
          { label: "Объём", complete: volumeConfirmed },
          { label: "Материалы", complete: false },
          { label: "Текст", complete: false },
          { label: "Слайды", complete: false },
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

      {narrationProjectId ? (
        <div className="wizard-main wizard-recovery" aria-labelledby="wizard-recovery-title">
          <div className="wizard-content">
            <span className="status status-failed">Проект создан</span>
            <h1 id="wizard-recovery-title" className="wizard-question">Остался один шаг</h1>
            <p className="muted">Не удалось запустить подготовку текста. Повтори только этот запуск — тему, объём и материалы выбирать заново не нужно.</p>
          </div>
          <div className="actions action-row new-wizard-actions new-wizard-actions-single">
            <button className="button" type="button" data-testid="new-project-narration-retry" onClick={() => void retryNarration(narrationProjectId)} disabled={busy}>
              {busy ? "Запускаем подготовку..." : "Повторить подготовку текста"}
            </button>
          </div>
          <AnimatePresence initial={false}>
            {error ? <motion.p className="form-error" role="alert" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">{error}</motion.p> : null}
          </AnimatePresence>
        </div>
      ) : (
      <div className="wizard-main">
        <AnimatePresence initial={false} mode="wait">
        {step === 0 ? (
          <motion.div key="topic" className="wizard-pane wizard-pane-topic" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
            <div className="wizard-content">
              <div className="field">
                <h1 id="wizard-topic-title" className="wizard-question">О чём будет презентация?</h1>
                <textarea
                  className="textarea topic-input"
                  id="new-project-topic"
                  data-testid="new-project-topic"
                  aria-labelledby="wizard-topic-title"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Например: как AI меняет высшее образование"
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") nextFromTopic();
                  }}
                />
              </div>
            </div>
            <div className="actions action-row new-wizard-actions new-wizard-actions-single">
              <button className="button" data-testid="new-project-next" type="button" onClick={nextFromTopic}>
                Продолжить
              </button>
            </div>
          </motion.div>
        ) : null}

        {step === 1 ? (
          <motion.div key="volume" className="wizard-pane wizard-pane-volume" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
            <div className="wizard-content">
              <h1 className="wizard-question">Сколько слайдов собрать?</h1>
              <div className="slide-count-options" role="radiogroup" aria-label="Количество слайдов">
                {availableSlideOptions.map((option, index) => (
                  <button
                    className={`choice-button ${slideCount === option.count ? "choice-button-active" : ""}`}
                    key={option.count}
                    type="button"
                    role="radio"
                    aria-checked={slideCount === option.count}
                    tabIndex={slideCount === option.count ? 0 : -1}
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
            <div className="actions action-row new-wizard-actions">
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
              <h1 className="wizard-question">На что опираться?</h1>
              <div className="source-choices" role="radiogroup" aria-label="Источник материала">
                <button
                  className={`source-choice ${sourceMode === "web" ? "source-choice-active" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={sourceMode === "web"}
                  tabIndex={sourceMode === "web" ? 0 : -1}
                  onClick={() => {
                    setSourceMode("web");
                    setError("");
                  }}
                  onKeyDown={(event) => focusRadioOption(event, 0, 2, (nextIndex) => setSourceMode(nextIndex === 0 ? "web" : "files"))}
                >
                  <Search aria-hidden="true" size={20} />
                  <span>
                    <strong>Найти источники в интернете</strong>
                  </span>
                </button>
                <button
                  className={`source-choice ${sourceMode === "files" ? "source-choice-active" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={sourceMode === "files"}
                  tabIndex={sourceMode === "files" ? 0 : -1}
                  onClick={() => {
                    setSourceMode("files");
                    setError("");
                  }}
                  onKeyDown={(event) => focusRadioOption(event, 1, 2, (nextIndex) => setSourceMode(nextIndex === 0 ? "web" : "files"))}
                >
                  <FileUp aria-hidden="true" size={20} />
                  <span>
                    <strong>Использовать мои материалы</strong>
                  </span>
                </button>
              </div>
              {uploadRecovery ? (
                <p className="source-upload-recovery" data-testid="new-project-upload-recovery">
                  {phase === "upload_failed"
                    ? "Проект создан, но файл не загрузился. Выбери файлы заново и повтори только загрузку."
                    : phase === "uploading"
                      ? "Проект уже создан, но загрузка не завершилась. Выбери файлы заново, чтобы продолжить."
                      : "Проект уже создан. Выбери файлы, чтобы продолжить загрузку без создания нового проекта."}
                </p>
              ) : null}
              {filesNeedReselection ? (
                <p className="source-upload-recovery" data-testid="new-project-files-reselection">
                  Выбранные файлы не сохраняются после обновления страницы. Выбери их заново, чтобы продолжить.
                </p>
              ) : null}
              <AnimatePresence initial={false} mode="popLayout">
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
                  ) : null}
                </motion.div>
              ) : null}
              </AnimatePresence>
            </div>
            <div className="actions action-row new-wizard-actions">
              <button className="ghost" type="button" onClick={() => setStep(1)} disabled={busy}>
                Назад
              </button>
              <button className="button" data-testid="new-project-next" type="button" onClick={createProjectDraft} disabled={busy || (sourceMode === "files" && !files.length)}>
                {busy ? "Создаём проект..." : "Продолжить"}
              </button>
            </div>
          </motion.div>
        ) : null}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {error ? <motion.p className="form-error" role="alert" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">{error}</motion.p> : null}
        </AnimatePresence>
      </div>
      )}
    </section>
  );
}

function focusRadioOption(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  count: number,
  onSelect: (index: number) => void,
) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? count - 1
      : (index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + count) % count;
  onSelect(nextIndex);
  const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  radios?.[nextIndex]?.focus();
}

function projectTitleFromTopic(topic: string) {
  const normalized = topic.replace(/\s+/g, " ").trim();
  if (normalized.length <= projectTitleLimit) return normalized;
  return `${normalized.slice(0, projectTitleLimit - 3).trimEnd()}...`;
}

export function studentPrompt(topic: string, slideCount: number) {
  const timingBudget = getRussianStudentSpeechTimingBudget({ slideCount, level: "general", mode: "with_sources" });
  return [
    `Подготовь понятную презентацию на ${slideCount} слайдов по теме: ${topic}.`,
    timingBudget
      ? `Длительность выступления: ${timingBudget.minMinutes}${timingBudget.maxMinutes === undefined ? "+" : `-${timingBudget.maxMinutes}`} минут; ориентир ${timingBudget.targetWords} слов при ${timingBudget.wordsPerMinute} словах в минуту.`
      : "",
    "Слайды должны быть короткими и визуально аккуратными: один сильный тезис, минимум текста, изображения, схемы или диаграммы там, где они помогают объяснению.",
    "Основное объяснение перенеси в заметки докладчика: текст должен звучать естественно, уверенно и соответствовать теме.",
    "Результат должен одинаково хорошо смотреться в веб-превью и в экспорте PPTX/PDF.",
  ].join(" ");
}
