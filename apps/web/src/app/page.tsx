import type { Metadata } from "next";
import "./landing.css";
import {
  ArrowRight,
  BookOpenCheck,
  FileText,
  Mic2,
  Presentation,
  Sparkles,
} from "lucide-react";
import { FiveMinuteTimeline } from "@/components/landing/five-minute-timeline";
import { LazyDemoGallery } from "@/components/landing/lazy-demo-gallery";
import { LandingFinalCta } from "@/components/landing/landing-final-cta";
import { LandingHero } from "@/components/landing/landing-hero";
import { PublicRouteLayout } from "@/components/public-route-layout";

export const metadata: Metadata = {
  title: "StudyDeck AI — презентация и речь за 5 минут",
  description: "Начни с одной темы и подготовь студенческую презентацию, связную речь и материалы для защиты примерно за 5 минут.",
};

export default function HomePage() {
  return (
    <PublicRouteLayout>
      <main className="landing-page" id="main-content">
      <LandingHero />

      <section className="landing-transform-section" id="capabilities" aria-labelledby="landing-transform-title">
        <header className="landing-section-heading landing-transform-heading">
          <p className="landing-section-label">Одна тема — это уже достаточно</p>
          <h2 id="landing-transform-title">Не нужен длинный промпт, чтобы начать готовиться к защите.</h2>
          <p>Дальше StudyDeck раскладывает задачу на понятный маршрут: содержание, аргументы, речь и слайды.</p>
        </header>

        <div className="landing-transform-flow">
          <article className="landing-topic-artifact">
            <span className="landing-artifact-label">Тема выступления</span>
            <strong>Как искусственный интеллект меняет образование</strong>
            <span className="landing-artifact-note">Одна короткая формулировка — без сложного технического задания.</span>
          </article>

          <div className="landing-transform-connector" aria-hidden="true">
            <span><Sparkles size={20} /></span>
            <i />
            <b>StudyDeck собирает основу</b>
          </div>

          <div className="landing-result-artifacts">
            <article className="landing-result-deck">
              <span className="landing-artifact-label"><Presentation size={17} aria-hidden="true" /> Презентация</span>
              <strong>8 ясных слайдов</strong>
              <p>Структура, визуальный ритм и тезисы, которые удобно объяснять вслух.</p>
            </article>
            <article className="landing-result-speech">
              <span className="landing-artifact-label"><Mic2 size={17} aria-hidden="true" /> Готовая речь</span>
              <p>«Сначала покажу, что AI не заменяет обучение, а помогает студенту быстрее разобраться в материале…»</p>
              <span>По слайдам · можно отредактировать</span>
            </article>
            <div className="landing-result-support" aria-label="Дополнительные материалы">
              <span><BookOpenCheck aria-hidden="true" size={16} /> Проверяемые источники</span>
              <span><FileText aria-hidden="true" size={16} /> Заметки и PDF/PPTX/DOCX</span>
            </div>
          </div>
        </div>
      </section>

      <LazyDemoGallery />
      <FiveMinuteTimeline />

      <section className="landing-output-section" aria-labelledby="landing-output-title">
        <header className="landing-section-heading landing-output-heading">
          <p className="landing-section-label">Результат, с которым можно выступать</p>
          <h2 id="landing-output-title">Два главных артефакта, а не ещё один «готовый файл».</h2>
        </header>

        <div className="landing-output-layout">
          <article className="landing-output-presentation">
            <span className="landing-output-icon"><Presentation aria-hidden="true" size={29} /></span>
            <div>
              <h3>Презентация</h3>
              <p>Слайды собираются в цельный рассказ, а не в набор разрозненных тезисов.</p>
            </div>
            <div className="landing-output-slide-motif" aria-hidden="true">
              <span>Тезис</span><span>Схема</span><span>Вывод</span>
            </div>
          </article>

          <article className="landing-output-speech">
            <span className="landing-output-icon"><Mic2 aria-hidden="true" size={29} /></span>
            <div>
              <h3>Текст выступления</h3>
              <p>Связная речь уже разбита по слайдам: её легко сократить, уточнить и проговорить заранее.</p>
            </div>
            <div className="landing-output-lines" aria-hidden="true"><i /><i /><i /><i /></div>
          </article>
        </div>
      </section>

      <LandingFinalCta />

      <a className="landing-sticky-create" href="/new">
        Создать за 5 минут <ArrowRight aria-hidden="true" size={17} />
      </a>
      </main>
    </PublicRouteLayout>
  );
}
