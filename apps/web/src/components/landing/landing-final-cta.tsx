import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { LandingFinalCtaArtifact } from "@/components/landing/landing-final-cta-artifact";
import { LANDING_SHOWCASE_FIXTURES } from "@/lib/landing-demo-data";

export function LandingFinalCta() {
  const featuredFixture = LANDING_SHOWCASE_FIXTURES[0];
  const speechExcerpt = featuredFixture?.presentation.speechScript[0]?.text
    || "Тема уже превратилась в понятный план, слайды и готовую речь.";

  return (
    <section className="landing-final-cta" aria-labelledby="landing-final-cta-title">
      <div className="landing-final-cta-copy">
        <p className="landing-final-cta-status"><Check aria-hidden="true" size={17} /> Всё нужное — в одном проекте</p>
        <h2 id="landing-final-cta-title">Следующая презентация начинается с одной темы</h2>
        <p>
          Не откладывай защиту до последнего вечера: собери основу,
          отредактируй детали и выходи выступать увереннее.
        </p>
        <Link className="button landing-final-cta-action" href="/new">
          Создать за 5 минут <ArrowRight aria-hidden="true" size={19} />
        </Link>
      </div>

      {featuredFixture ? (
        <LandingFinalCtaArtifact
          document={featuredFixture.presentation}
          speechExcerpt={speechExcerpt}
        />
      ) : null}
    </section>
  );
}
