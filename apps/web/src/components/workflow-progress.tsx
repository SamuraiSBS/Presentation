"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const generationStages = ["Тема", "Объём", "Материалы", "Текст", "Слайды"];

export function WorkflowProgress({ current, includeExport = false }: { current: number; includeExport?: boolean }) {
  const stages = includeExport ? [...generationStages, "Экспорт"] : generationStages;
  const progressRef = useRef<HTMLOListElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  useEffect(() => {
    const progress = progressRef.current;
    if (!progress) return;

    const updateOverflow = () => {
      const maxScrollLeft = progress.scrollWidth - progress.clientWidth;
      setOverflow({ start: progress.scrollLeft > 1, end: progress.scrollLeft < maxScrollLeft - 1 });
    };

    const keepActiveStepVisible = () => {
      const activeStep = progress.querySelector<HTMLElement>('[aria-current="step"]');
      if (activeStep) {
        const maxScrollLeft = Math.max(0, progress.scrollWidth - progress.clientWidth);
        const targetScrollLeft = Math.min(
          maxScrollLeft,
          Math.max(0, activeStep.offsetLeft - (progress.clientWidth - activeStep.offsetWidth) / 2),
        );
        if (Math.abs(progress.scrollLeft - targetScrollLeft) > 1) {
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            progress.scrollLeft = targetScrollLeft;
          } else {
            progress.scrollTo({ left: targetScrollLeft, behavior: "smooth" });
          }
        }
      }

      updateOverflow();
    };

    keepActiveStepVisible();
    const animationFrame = window.requestAnimationFrame(keepActiveStepVisible);
    progress.addEventListener("scroll", updateOverflow, { passive: true });
    const resizeObserver = new ResizeObserver(keepActiveStepVisible);
    resizeObserver.observe(progress);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      progress.removeEventListener("scroll", updateOverflow);
      resizeObserver.disconnect();
    };
  }, [current]);

  return (
    <ol
      className="journey-progress"
      aria-label="Этапы подготовки презентации"
      data-overflow-start={overflow.start || undefined}
      data-overflow-end={overflow.end || undefined}
      ref={progressRef}
    >
      {stages.map((label, index) => {
        const complete = index < current;
        const active = index === current;
        return (
          <li
            className={`${complete ? "journey-progress-complete" : ""} ${active ? "journey-progress-active" : ""}`}
            aria-current={active ? "step" : undefined}
            key={label}
          >
            <span>{complete ? <Check aria-hidden="true" size={16} /> : index + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
