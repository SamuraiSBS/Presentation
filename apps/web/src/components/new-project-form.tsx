"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, FileUp, GraduationCap, School, Search } from "lucide-react";
import type { UsageSummary } from "@/lib/account-types";
import { canCreateProject } from "@/lib/account-types";
import { formatResetDate } from "@/lib/project-ui";
import { ApiClientError, apiJson } from "@/lib/project-queries";

const slideOptions = [
  { count: 6, label: "Короткое выступление", description: "5-7 минут" },
  { count: 8, label: "Доклад на паре", description: "7-9 минут" },
  { count: 10, label: "Обычная презентация", description: "10-12 минут" },
  { count: 12, label: "Подробный доклад", description: "12-15 минут" },
  { count: 14, label: "Защита проекта", description: "от 15 минут" },
];

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

  async function createProjectAndNarration() {
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

      await apiJson(`/api/projects/${project.id}/narration`, { method: "POST" });
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
          { label: "Объём", complete: step > 1 },
          { label: "Источники", complete: false },
        ].map((item, index) => {
          const targetStep = index;
          const available = targetStep === 0 || Boolean(normalizedTopic);
          const active = step === targetStep;

          return (
            <button
              className={`wizard-progress-step ${active ? "wizard-progress-step-active" : ""} ${item.complete ? "wizard-progress-step-complete" : ""}`}
              key={item.label}
              type="button"
              disabled={!available}
              aria-current={active ? "step" : undefined}
              onClick={() => setStep(targetStep)}
            >
              <span>{item.complete ? <Check aria-hidden="true" size={14} strokeWidth={3} /> : index + 1}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="wizard-main">
        {step === 0 ? (
          <div className="wizard-pane wizard-pane-topic">
            <div className="wizard-content">
              <label className="field">
                <span className="wizard-question">О чём будет презентация?</span>
                <textarea
                  className="textarea topic-input"
                  data-testid="new-project-topic"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Например: как AI меняет высшее образование"
                  autoFocus
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
              <button className="button" type="button" onClick={nextFromTopic} disabled={!creationAllowed}>
                Продолжить
              </button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="wizard-pane wizard-pane-volume">
            <div className="wizard-content">
              <div className="wizard-intro">
                <h2 className="wizard-question">Сколько слайдов собрать?</h2>
                <p className="muted">По умолчанию выбрали оптимальный объём для обычного выступления.</p>
              </div>
              <div className="slide-count-options" role="radiogroup" aria-label="Количество слайдов">
                {availableSlideOptions.map((option) => (
                  <button
                    className={`choice-button ${slideCount === option.count ? "choice-button-active" : ""}`}
                    key={option.count}
                    type="button"
                    role="radio"
                    aria-checked={slideCount === option.count}
                    onClick={() => setSlideCount(option.count)}
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
              <button className="button" type="button" onClick={() => setStep(2)}>
                Продолжить
              </button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className={`wizard-pane wizard-pane-sources ${sourceMode === "files" ? "wizard-pane-sources-files" : ""}`}>
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
                >
                  <FileUp aria-hidden="true" size={20} />
                  <span>
                    <strong>Использовать мои материалы</strong>
                    <small>Конспект, задание или готовые источники.</small>
                  </span>
                </button>
              </div>
              {sourceMode === "web" ? (
                <div className="source-web-note">
                  <strong>Можно продолжать</strong>
                  <span>Ничего загружать не нужно: подберём подходящие источники по теме и подготовим текст выступления.</span>
                </div>
              ) : null}
              {sourceMode === "files" ? (
                <>
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
                    <div className="source-list" aria-label="Выбранные файлы">
                      {files.map((file) => (
                        <div className="source-item" key={`${file.name}-${file.size}`}>
                          <strong>{file.name}</strong>
                          <span>{formatFileSize(file.size)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="source-file-hint">Добавь хотя бы один файл, чтобы продолжить с собственными материалами.</p>
                  )}
                </>
              ) : null}
            </div>
            <div className="actions action-row">
              <button className="ghost" type="button" onClick={() => setStep(1)} disabled={busy}>
                Назад
              </button>
              <button className="button" type="button" onClick={createProjectAndNarration} disabled={busy || !creationAllowed}>
                {busy ? "Готовим текст..." : "Подготовить текст"}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </section>
  );
}

function projectTitleFromTopic(topic: string) {
  const normalized = topic.replace(/\s+/g, " ").trim();
  if (normalized.length <= projectTitleLimit) return normalized;
  return `${normalized.slice(0, projectTitleLimit - 3).trimEnd()}...`;
}

function studentPrompt(topic: string, slideCount: number, audience: "school" | "university") {
  const audienceCopy = audience === "school"
    ? "школьную презентацию с понятными формулировками, подходящими для выступления перед классом"
    : "академическую, но лёгкую для устного выступления студенческую презентацию";
  return [
    `Подготовь ${audienceCopy} на ${slideCount} слайдов по теме: ${topic}.`,
    "Слайды должны быть короткими и визуально аккуратными: один сильный тезис, минимум текста, изображения, схемы или диаграммы там, где они помогают объяснению.",
    audience === "school" ? "Основное объяснение перенеси в заметки докладчика: текст должен звучать естественно для школьника." : "Основное объяснение перенеси в заметки докладчика: текст должен звучать профессионально и естественно для студента.",
    "Результат должен одинаково хорошо смотреться в веб-превью и в экспорте PPTX/PDF.",
  ].join(" ");
}
