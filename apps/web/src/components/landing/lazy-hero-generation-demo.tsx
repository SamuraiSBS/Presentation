"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";

type HeroGenerationDemoProps = { className?: string };

export function LazyHeroGenerationDemo({ className }: { className?: string }) {
  const [Demo, setDemo] = useState<ComponentType<HeroGenerationDemoProps> | null>(null);

  useEffect(() => {
    // The animated preview is supplementary. Let the heading paint before its
    // motion runtime and timers compete with the first render.
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void import("@/components/landing/hero-generation-demo").then(({ HeroGenerationDemo }) => {
        if (!cancelled) setDemo(() => HeroGenerationDemo);
      });
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  if (!Demo) {
    return <figure className={className ? `hero-generation-demo ${className}` : "hero-generation-demo"} aria-busy="true" aria-label="Загрузка примера презентации" />;
  }

  return <Demo className={className} />;
}
