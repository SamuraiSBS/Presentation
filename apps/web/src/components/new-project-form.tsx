"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const slideOptions = [6, 8, 10, 12, 14];

export function NewProjectForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(10);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const normalizedTopic = topic.trim();

  function nextFromTopic() {
    setError("");
    if (normalizedTopic.length < 2) {
      setError("Введите тему презентации.");
      return;
    }
    setStep(1);
  }

  async function createProjectAndNarration() {
    setBusy(true);
    setError("");

    try {
      const createResponse = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: normalizedTopic,
          prompt: `Сделай понятную учебную презентацию на ${slideCount} слайдов по теме: ${normalizedTopic}. Сначала подготовь подробный связный текст выступления, а на слайды вынеси только короткие тезисы.`,
          scenario: "school_report",
          level: "8-11 класс",
          mode: "with_sources",
          slideCount,
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
      setError(err instanceof Error ? err.message : "Не удалось создать презентацию");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wizard panel" aria-label="Создание презентации">
      <div className="wizard-steps" aria-label="Шаги">
        {["Тема", "Слайды", "Материалы"].map((label, index) => (
          <span className={`wizard-step ${index === step ? "wizard-step-active" : ""} ${index < step ? "wizard-step-done" : ""}`} key={label}>
            <span>{index + 1}</span>
            {label}
          </span>
        ))}
      </div>

      {step === 0 ? (
        <div className="wizard-pane">
          <label className="field">
            Тема презентации
            <textarea
              className="textarea topic-input"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Например: Искусственный интеллект в образовании"
              autoFocus
            />
          </label>
          <div className="actions">
            <button className="button" type="button" onClick={nextFromTopic}>
              Далее
            </button>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="wizard-pane">
          <div>
            <h2>Сколько слайдов нужно?</h2>
            <p className="muted">Выберите объём выступления. Текст будет подготовлен под это количество слайдов.</p>
          </div>
          <div className="slide-count-options" role="radiogroup" aria-label="Количество слайдов">
            {slideOptions.map((count) => (
              <button
                className={`choice-button ${slideCount === count ? "choice-button-active" : ""}`}
                key={count}
                type="button"
                role="radio"
                aria-checked={slideCount === count}
                onClick={() => setSlideCount(count)}
              >
                <strong>{count}</strong>
                <span>слайдов</span>
              </button>
            ))}
          </div>
          <div className="actions">
            <button className="ghost" type="button" onClick={() => setStep(0)}>
              Назад
            </button>
            <button className="button" type="button" onClick={() => setStep(2)}>
              Далее
            </button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="wizard-pane">
          <label className="field">
            Материалы
            <input
              className="input"
              type="file"
              accept=".pdf,.docx,.pptx,.txt,.md,.csv"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files || []))}
            />
          </label>
          <p className="muted">
            Материалы можно не добавлять. Если файлов нет, StudyDeck подготовит текст по теме и при необходимости использует web-поиск.
          </p>
          {files.length ? <p className="muted">Выбрано файлов: {files.length}</p> : null}
          <div className="actions">
            <button className="ghost" type="button" onClick={() => setStep(1)} disabled={busy}>
              Назад
            </button>
            <button className="button" type="button" onClick={createProjectAndNarration} disabled={busy}>
              {busy ? "Генерируем текст..." : "Сгенерировать текст"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
