"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import { RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS } from "@studydeck/shared";

const slideOptions = RUSSIAN_STUDENT_SPEECH_TIMING_PRESETS.map((preset) => ({
  count: preset.slideCount,
  label: preset.label,
  description: preset.maxMinutes === undefined ? `от ${preset.minMinutes} минут` : `${preset.minMinutes}–${preset.maxMinutes} минут`,
}));

export function LandingFinalCta() {
  const [step, setStep] = useState<0 | 1>(0);
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(10);
  const [error, setError] = useState("");

  function continueToVolume() {
    if (topic.trim().length < 2) {
      setError("Напиши тему презентации.");
      return;
    }

    setError("");
    setStep(1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === 0) continueToVolume();
    // The landing CTA is intentionally a visual preview until the generation flow is connected.
  }

  return (
    <section className="landing-final-cta" id="create" aria-labelledby="landing-final-cta-title">
      <div className="landing-final-cta-copy">
        <p className="landing-final-cta-status"><Check aria-hidden="true" size={17} /> Сначала результат, потом генерация</p>
        <h2 id="landing-final-cta-title">Попробуй собрать свою презентацию</h2>
        <p>
          Выбери тему и объём выступления — так будет выглядеть первый шаг в Lazyum. Дальше сервис соберёт слайды и текст речи в одном проекте.
        </p>
      </div>

      <form className="landing-cta-wizard" onSubmit={handleSubmit} aria-label="Настройка презентации">
        <ol className="landing-cta-progress" aria-label="Шаги создания презентации">
          <li className={step === 0 ? "landing-cta-progress-active" : "landing-cta-progress-done"}>
            <span>1</span> Тема
          </li>
          <li className={step === 1 ? "landing-cta-progress-active" : ""}>
            <span>2</span> Объём
          </li>
        </ol>

        {step === 0 ? (
          <div className="landing-cta-pane">
            <label className="landing-cta-field">
              <span className="landing-cta-question">О чём будет презентация?</span>
              <textarea
                className="textarea landing-cta-topic"
                data-testid="landing-cta-topic"
                value={topic}
                onChange={(event) => {
                  setTopic(event.target.value);
                  if (error) setError("");
                }}
                placeholder="Например: как AI меняет высшее образование"
                autoComplete="off"
              />
            </label>
            {error ? <p className="landing-cta-error" role="alert">{error}</p> : null}
            <button className="button landing-cta-action" type="submit">
              Продолжить <ArrowRight aria-hidden="true" size={18} />
            </button>
          </div>
        ) : (
          <div className="landing-cta-pane">
            <div className="landing-cta-intro">
              <h3 className="landing-cta-question">Сколько слайдов собрать?</h3>
              <p>Выбери объём — речь подстроится под длительность выступления.</p>
            </div>
            <div className="landing-cta-topic-preview">
              <span>Тема</span>
              <strong>{topic.trim()}</strong>
            </div>
            <div className="landing-cta-slide-options" role="radiogroup" aria-label="Количество слайдов">
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
            <div className="landing-cta-actions">
              <button className="ghost" type="button" onClick={() => setStep(0)}>
                Назад
              </button>
              <button className="button landing-cta-action" data-testid="landing-cta-generate" type="submit">
                Сгенерировать <ArrowRight aria-hidden="true" size={18} />
              </button>
            </div>
            <p className="landing-cta-note">Пока это только демонстрация окна — генерация не запускается.</p>
          </div>
        )}
      </form>
    </section>
  );
}
