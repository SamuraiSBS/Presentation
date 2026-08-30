"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { ArrowUpRight, Check, FileText, Mic2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  LANDING_SHOWCASE_FIXTURES,
  type LandingShowcaseFixture,
  type LandingShowcaseFixtureId,
} from "@/lib/landing-demo-data";
import { DemoDeckPreview, DemoSlidePreview } from "@/components/landing/demo-deck-preview";

const showcaseDetails = {
  "ai-education": {
    subtitle: "Технологии, инфографика и современная аудитория",
    accent: "var(--landing-ai)",
  },
  "cuban-missile-crisis": {
    subtitle: "Архивный материал, хронология и дипломатический выбор",
    accent: "#a85243",
  },
  "renewable-energy": {
    subtitle: "Городская инфраструктура, метрики и чистая энергия",
    accent: "var(--landing-ready)",
  },
} satisfies Record<LandingShowcaseFixtureId, { subtitle: string; accent: string }>;

export function DemoGallery() {
  const [featuredFixture, ...supportingFixtures] = LANDING_SHOWCASE_FIXTURES;

  return (
    <section className="landing-showcase-section" id="examples" aria-labelledby="landing-showcase-title">
      <header className="landing-section-heading landing-showcase-heading">
        <p className="landing-section-label">Результат вживую</p>
        <h2 id="landing-showcase-title">Сначала посмотри, что получишь на выходе.</h2>
        <p>
          Не обещание «сгенерируем файл», а сам результат: слайды с логикой и текст выступления, который помогает их объяснить.
        </p>
      </header>

      {featuredFixture ? <ShowcaseCard fixture={featuredFixture} featured /> : null}

      {supportingFixtures.length ? (
        <ul className="landing-showcase-list">
          {supportingFixtures.map((fixture) => (
            <li key={fixture.id}>
              <ShowcaseCard fixture={fixture} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ShowcaseCard({ fixture, featured = false }: { fixture: LandingShowcaseFixture; featured?: boolean }) {
  const details = showcaseDetails[fixture.id];
  const speechExcerpt = fixture.presentation.speechScript[0]?.text || fixture.presentation.slides[0]?.speakerNotes || "";
  const accentStyle = { "--landing-showcase-accent": details.accent } as CSSProperties;

  return (
    <article className={`landing-showcase ${featured ? "landing-showcase-featured" : ""}`} style={accentStyle}>
      <Dialog>
        <div className="landing-showcase-top">
          <div className="landing-showcase-cover">
            <Image
              alt={fixture.cover.alt}
              fill
              sizes="(max-width: 720px) calc(100vw - 40px), (max-width: 1100px) 48vw, 32vw"
              src={fixture.cover.src}
            />
          </div>
          <div className="landing-showcase-copy">
            <span className="landing-showcase-type">{details.subtitle}</span>
            <h3>{fixture.presentation.title}</h3>
            <p className="landing-showcase-caption">{fixture.cover.caption}</p>
            <span className="landing-showcase-ready"><Check aria-hidden="true" size={15} /> Готовая презентация и речь</span>
          </div>
        </div>

        <div className="landing-showcase-output" aria-label="Пример презентации и текста выступления">
          <div className="landing-showcase-preview">
            <span className="landing-showcase-output-label"><FileText aria-hidden="true" size={15} /> Фрагмент презентации</span>
            {featured ? (
              <DemoDeckPreview
                className="landing-showcase-inline-deck"
                document={fixture.presentation}
                title={fixture.presentation.title}
                maxSlides={3}
                variant="stack"
              />
            ) : <DemoSlidePreview document={fixture.presentation} />}
          </div>
          <div className="landing-showcase-speech-preview">
            <span className="landing-showcase-output-label"><Mic2 aria-hidden="true" size={15} /> Текст выступления</span>
            <p>{speechExcerpt}</p>
            <span className="landing-showcase-speech-pages">Разбит по слайдам · можно редактировать</span>
          </div>
        </div>

        <DialogTrigger asChild>
          <button className="landing-showcase-open" type="button" aria-haspopup="dialog">
            Открыть все слайды и речь <ArrowUpRight aria-hidden="true" size={17} />
          </button>
        </DialogTrigger>

        <DialogContent className="landing-showcase-dialog" style={accentStyle}>
          <DialogHeader className="landing-showcase-dialog-header">
            <p className="landing-showcase-dialog-label">Полный пример</p>
            <DialogTitle>{fixture.presentation.title}</DialogTitle>
            <DialogDescription>{details.subtitle}</DialogDescription>
          </DialogHeader>

          <div className="landing-showcase-dialog-body">
            <DemoDeckPreview
              className="landing-showcase-dialog-deck"
              document={fixture.presentation}
              title={fixture.presentation.title}
              variant="sequence"
            />

            <aside className="landing-showcase-speech" aria-label="Фрагмент готовой речи">
              <span className="landing-showcase-speech-icon"><Mic2 aria-hidden="true" size={18} /></span>
              <div>
                <p>Фрагмент готовой речи</p>
                <blockquote>{speechExcerpt}</blockquote>
              </div>
              <span className="landing-showcase-speech-notes"><FileText aria-hidden="true" size={15} /> По слайдам</span>
            </aside>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}
