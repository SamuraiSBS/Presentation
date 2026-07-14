"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { ArrowUpRight, FileText, Mic2 } from "lucide-react";
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
import { DemoDeckPreview } from "@/components/landing/demo-deck-preview";

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
  return (
    <section className="landing-showcase-section" id="examples" aria-labelledby="landing-showcase-title">
      <header className="landing-section-heading landing-showcase-heading">
        <h2 id="landing-showcase-title">Три темы. Три совершенно разные защиты.</h2>
        <p>
          Посмотри, как одна и та же студенческая задача превращается в цельную презентацию и связную речь.
        </p>
      </header>

      <ul className="landing-showcase-list">
        {LANDING_SHOWCASE_FIXTURES.map((fixture) => (
          <li key={fixture.id}>
            <ShowcaseCard fixture={fixture} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShowcaseCard({ fixture }: { fixture: LandingShowcaseFixture }) {
  const details = showcaseDetails[fixture.id];
  const speechExcerpt = fixture.presentation.speechScript[0]?.text || fixture.presentation.slides[0]?.speakerNotes || "";
  const accentStyle = { "--landing-showcase-accent": details.accent } as CSSProperties;

  return (
    <article className="landing-showcase" style={accentStyle}>
      <Dialog>
        <DialogTrigger asChild>
          <button
            className="landing-showcase-trigger"
            type="button"
            aria-label={`Открыть пример презентации «${fixture.presentation.title}»`}
            aria-haspopup="dialog"
          >
            <span className="landing-showcase-cover">
              <Image
                alt={fixture.cover.alt}
                fill
                sizes="(max-width: 720px) calc(100vw - 40px), (max-width: 1100px) 48vw, 32vw"
                src={fixture.cover.src}
              />
            </span>
            <span className="landing-showcase-copy">
              <span className="landing-showcase-type">{details.subtitle}</span>
              <strong>{fixture.presentation.title}</strong>
              <span className="landing-showcase-caption">{fixture.cover.caption}</span>
              <span className="landing-showcase-open">
                Открыть презентацию <ArrowUpRight aria-hidden="true" size={17} />
              </span>
            </span>
          </button>
        </DialogTrigger>

        <DialogContent className="landing-showcase-dialog" style={accentStyle}>
          <DialogHeader className="landing-showcase-dialog-header">
            <p className="landing-showcase-dialog-label">Showcase-презентация</p>
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
