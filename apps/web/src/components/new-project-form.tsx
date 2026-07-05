"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

export function NewProjectForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(10);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const normalizedTopic = topic.trim();
  const activeSlideOption = slideOptions.find((option) => option.count === slideCount);

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
  }

  function formatFileSize(size: number) {
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
    return `${(size / 1024 / 1024).toFixed(1)} МБ`;
  }

  async function createProjectAndNarration() {
    setBusy(true);
    setError("");

    try {
      const createResponse = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: projectTitleFromTopic(normalizedTopic),
          prompt: studentPrompt(normalizedTopic, slideCount),
          scenario: "university_report",
          level: "university_student",
          mode: "with_sources",
          slideCount,
          generationBrief: studentGenerationBrief,
        }),
      });
      if (!createResponse.ok) throw new Error(await createResponse.text());
      const project = await createResponse.json();

      if (files.length) {
        const uploadBody = new FormData();
        files.forEach((file) => uploadBody.append("files", file));
        const uploadResponse = await fetch(`/api/projects/${project.id}/uploads`, { method: "POST", body: uploadBody });
        if (!uploadResponse.ok) throw new Error(await uploadResponse.text());
      }

      const narrationResponse = await fetch(`/api/projects/${project.id}/narration`, { method: "POST" });
      if (!narrationResponse.ok) throw new Error(await narrationResponse.text());
      router.push(`/projects/${project.id}/script`);
    } catch (err) {
      setError(err instanceof Error && /[А-Яа-яЁё]/.test(err.message) ? err.message : "Не получилось начать работу. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wizard panel new-workspace" aria-label="Создание презентации">
      <div className="wizard-main">
        {step === 0 ? (
          <div className="wizard-pane">
            <div className="wizard-content">
              <label className="field">
                <span className="wizard-question">О чём будет презентация?</span>
                <textarea
                  className="textarea topic-input"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Например: как AI меняет высшее образование"
                  autoFocus
                />
              </label>
            </div>
            <div className="actions action-row">
              <button className="button" type="button" onClick={nextFromTopic}>
                Дальше
              </button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="wizard-pane">
            <div className="wizard-content">
              <div>
                <h2 className="wizard-question">Сколько слайдов собрать?</h2>
                <p className="muted">Выбери подходящую длину. На слайдах оставим главное, а подробный рассказ добавим в заметки.</p>
              </div>
              <div className="slide-count-options" role="radiogroup" aria-label="Количество слайдов">
                {slideOptions.map((option) => (
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
                Дальше
              </button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="wizard-pane">
            <div className="wizard-content">
              <div>
                <h2 className="wizard-question">Есть конспект или задание?</h2>
                <p className="muted">Добавь их сюда, чтобы презентация точнее попала в тему. Если материалов нет, просто пропусти этот шаг.</p>
              </div>
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
                <span>Перетащи сюда PDF, DOCX, PPTX или TXT</span>
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
                <div className="source-mode">
                  <strong>Файлы не обязательны</strong>
                  <span>Если ничего не добавишь, начнём с темы и сами поищем подходящие источники.</span>
                </div>
              )}
            </div>
            <div className="actions action-row">
              <button className="ghost" type="button" onClick={() => setStep(1)} disabled={busy}>
                Назад
              </button>
              <button className="button" type="button" onClick={createProjectAndNarration} disabled={busy}>
                {busy ? "Готовим текст..." : "Подготовить текст"}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}
      </div>

      <aside className="wizard-summary" aria-label="Сводка презентации">
        <div className="summary-head">
          <span className="status">Черновик</span>
          <strong>{normalizedTopic || "Тема появится здесь"}</strong>
        </div>
        <div className="summary-steps">
          <button className={`summary-step ${step === 0 ? "summary-step-active" : ""}`} type="button" onClick={() => setStep(0)}>
            <span>Задание</span>
            <strong>{normalizedTopic ? "Готово" : "Напиши тему"}</strong>
          </button>
          <button
            className={`summary-step ${step === 1 ? "summary-step-active" : ""}`}
            type="button"
            onClick={() => {
              if (normalizedTopic) setStep(1);
            }}
            disabled={!normalizedTopic}
          >
            <span>Объём</span>
            <strong>{slideCount} слайдов</strong>
            <small>{activeSlideOption?.label}</small>
          </button>
          <button
            className={`summary-step ${step === 2 ? "summary-step-active" : ""}`}
            type="button"
            onClick={() => {
              if (normalizedTopic) setStep(2);
            }}
            disabled={!normalizedTopic}
          >
            <span>Источники</span>
            <strong>{files.length ? formatFileCount(files.length) : "Без файлов"}</strong>
            <small>{files.length ? "Возьмём их за основу" : "Найдём источники сами"}</small>
          </button>
        </div>
        <div className="source-confidence">
          <span>{files.length ? "Материалы добавлены" : "Можно продолжать"}</span>
          <strong>{files.length ? "Будем опираться на твои файлы." : "Начнём с темы и найдём источники в интернете."}</strong>
        </div>
      </aside>
    </section>
  );
}

function formatFileCount(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} файлов`;
  if (last === 1) return `${count} файл`;
  if (last >= 2 && last <= 4) return `${count} файла`;
  return `${count} файлов`;
}

function projectTitleFromTopic(topic: string) {
  const normalized = topic.replace(/\s+/g, " ").trim();
  if (normalized.length <= projectTitleLimit) return normalized;
  return `${normalized.slice(0, projectTitleLimit - 3).trimEnd()}...`;
}

function studentPrompt(topic: string, slideCount: number) {
  return [
    `Подготовь академическую, но легкую для устного выступления студенческую презентацию на ${slideCount} слайдов по теме: ${topic}.`,
    "Слайды должны быть короткими и визуально аккуратными: один сильный тезис, минимум текста, изображения, схемы или диаграммы там, где они помогают объяснению.",
    "Основное объяснение перенеси в заметки докладчика и текст выступления: он должен звучать профессионально, понятно и естественно для студента университета.",
    "Результат должен одинаково хорошо смотреться в веб-превью и в экспорте PPTX/PDF.",
  ].join(" ");
}
