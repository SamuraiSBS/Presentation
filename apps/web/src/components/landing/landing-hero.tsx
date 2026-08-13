import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { LazyHeroGenerationDemo } from "@/components/landing/lazy-hero-generation-demo";

export function LandingHero() {
  return (
    <section className="landing-hero" aria-labelledby="landing-hero-title">
      <div className="landing-hero-copy">
        <p className="landing-hero-kicker"><Sparkles aria-hidden="true" size={17} /> Пятиминутная студия презентаций</p>
        <h1 id="landing-hero-title">От одной темы до готового выступления за 5 минут</h1>
        <p className="landing-hero-lead">
          Напиши одну тему — StudyDeck соберёт презентацию и готовую речь для студенческого выступления или защиты.
        </p>

        <p className="landing-hero-path" aria-label="Одна тема превращается в план, слайды и готовую речь">
          <span>Одна тема</span>
          <ArrowRight aria-hidden="true" size={20} />
          <span>План, слайды и речь</span>
        </p>

        <div className="landing-hero-actions">
          <Link className="button landing-hero-primary-action" href="/new">
            Создать за 5 минут <ArrowRight aria-hidden="true" size={19} />
          </Link>
          <Link className="ghost landing-hero-secondary-action" href="#examples">
            Посмотреть примеры
          </Link>
        </div>
      </div>

      <LazyHeroGenerationDemo className="landing-hero-demo" />
    </section>
  );
}
