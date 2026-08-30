import type { Metadata } from "next";
import "./landing.css";
import { ArrowRight } from "lucide-react";
import { LazyDemoGallery } from "@/components/landing/lazy-demo-gallery";
import { LandingFinalCta } from "@/components/landing/landing-final-cta";
import { LandingHero } from "@/components/landing/landing-hero";
import { PublicRouteLayout } from "@/components/public-route-layout";

export const metadata: Metadata = {
  title: "Lazyum — презентация и речь за 5 минут",
  description: "Начни с одной темы и подготовь студенческую презентацию, связную речь и материалы для защиты примерно за 5 минут.",
};

export default function HomePage() {
  return (
    <PublicRouteLayout>
      <main className="landing-page" id="main-content">
        <LandingHero />

        <LazyDemoGallery />

        <LandingFinalCta />

        <a className="landing-sticky-create" href="/new">
          Создать за 5 минут <ArrowRight aria-hidden="true" size={17} />
        </a>
      </main>
    </PublicRouteLayout>
  );
}
