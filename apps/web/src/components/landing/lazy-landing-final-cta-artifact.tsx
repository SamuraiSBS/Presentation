"use client";

import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import type { PresentationDocument } from "@studydeck/shared";

type LandingFinalCtaArtifactProps = { document: PresentationDocument; speechExcerpt: string };

export function LazyLandingFinalCtaArtifact({ document, speechExcerpt }: { document: PresentationDocument; speechExcerpt: string }) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [Artifact, setArtifact] = useState<ComponentType<LandingFinalCtaArtifactProps> | null>(null);

  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (!placeholder) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        void import("@/components/landing/landing-final-cta-artifact").then(({ LandingFinalCtaArtifact }) => setArtifact(() => LandingFinalCtaArtifact));
        observer.disconnect();
      }
    }, { rootMargin: "320px" });

    observer.observe(placeholder);
    return () => observer.disconnect();
  }, []);

  return Artifact
    ? <Artifact document={document} speechExcerpt={speechExcerpt} />
    : <div ref={placeholderRef} aria-hidden="true" />;
}
