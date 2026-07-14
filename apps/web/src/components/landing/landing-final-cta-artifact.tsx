"use client";

import { type KeyboardEvent, useState } from "react";
import { Mic2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { PresentationDocument } from "@studydeck/shared";
import { DemoSlidePreview } from "@/components/landing/demo-deck-preview";
import { transitions } from "@/components/motion/motion-presets";

type LandingFinalCtaArtifactProps = {
  document: PresentationDocument;
  speechExcerpt: string;
};

type ArtifactView = "slides" | "speech";

function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>, onActivate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onActivate();
}

export function LandingFinalCtaArtifact({ document, speechExcerpt }: LandingFinalCtaArtifactProps) {
  const [activeView, setActiveView] = useState<ArtifactView>("slides");
  const shouldReduceMotion = useReducedMotion() === true;
  const transition = shouldReduceMotion ? { duration: 0 } : transitions.surface;
  const slideIsFront = activeView === "slides";

  return (
    <div className="landing-final-cta-artifact">
      <div className="landing-final-cta-card-stack" aria-label="Презентация и речь к ней">
        <motion.div
          className="landing-final-cta-card landing-final-cta-slide-card"
          role="button"
          tabIndex={0}
          aria-label="Показать речь к слайдам"
          onClick={() => setActiveView("speech")}
          onKeyDown={(event) => handleCardKeyDown(event, () => setActiveView("speech"))}
          animate={slideIsFront
            ? { x: 0, y: 0, scale: 1, rotate: 0, zIndex: 2 }
            : { x: 28, y: -20, scale: 0.88, rotate: 2, zIndex: 1 }}
          transition={transition}
        >
          <DemoSlidePreview className="landing-final-cta-slide" document={document} />
          <span className="landing-final-cta-card-hint">Нажмите, чтобы увидеть речь</span>
        </motion.div>

        <motion.div
          className="landing-final-cta-card landing-final-cta-speech-card"
          role="button"
          tabIndex={0}
          aria-label="Показать слайд"
          onClick={() => setActiveView("slides")}
          onKeyDown={(event) => handleCardKeyDown(event, () => setActiveView("slides"))}
          animate={slideIsFront
            ? { x: -28, y: 20, scale: 0.88, rotate: -2, zIndex: 1 }
            : { x: 0, y: 0, scale: 1, rotate: 0, zIndex: 2 }}
          transition={transition}
        >
          <article className="landing-final-cta-speech-sheet">
            <span><Mic2 aria-hidden="true" size={17} /> Речь к слайдам</span>
            <p>{speechExcerpt}</p>
          </article>
          <span className="landing-final-cta-card-hint">Нажмите, чтобы увидеть слайд</span>
        </motion.div>
      </div>
    </div>
  );
}
