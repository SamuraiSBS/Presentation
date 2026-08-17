"use client";

import { type CSSProperties, useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { Check, FileText, Mic2, Presentation, RefreshCw, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { motionDuration, motionEase, transitions } from "@/components/motion/motion-presets";
import { cn } from "@/lib/utils";
import {
  createInitialHeroDemoState,
  getHeroDemoTimer,
  hasReachedHeroDemoStep,
  heroDemoReducer,
  heroDemoStepLabels,
  heroDemoSteps,
  type HeroDemoState,
  type HeroDemoStep,
  type HeroDemoTimedAction,
} from "@/lib/hero-generation-demo";

const heroDemoTransition = {
  duration: motionDuration.page + motionDuration.control,
  ease: motionEase,
};

const instantTransition = { duration: 0 };

const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

const stageIcons = {
  topic: Sparkles,
  structure: FileText,
  speech: Mic2,
  slides: Presentation,
  ready: Check,
};

const slidePreviews = [
  { className: "hero-demo-slide hero-demo-slide-one", label: "1", title: "Образование меняется" },
  { className: "hero-demo-slide hero-demo-slide-two", label: "2", title: "Где помогает AI" },
  { className: "hero-demo-slide hero-demo-slide-three", label: "3", title: "Что остаётся за человеком" },
] as const;

type PausedTimer = {
  key: string;
  remaining: number;
};

type HeroGenerationDemoProps = {
  className?: string;
};

export function HeroGenerationDemo({ className }: HeroGenerationDemoProps) {
  const motionPreference = useReducedMotion();
  const shouldReduceMotion = motionPreference === true;
  const [state, dispatch] = useReducer(heroDemoReducer, undefined, createInitialHeroDemoState);
  const [documentIsVisible, setDocumentIsVisible] = useState(() => {
    return typeof document === "undefined" || document.visibilityState !== "hidden";
  });
  const pausedTimerRef = useRef<PausedTimer | null>(null);
  const timedActionRef = useRef<HeroDemoTimedAction | null>(null);
  const summaryId = useId();

  const timer = getHeroDemoTimer(state);
  const timerKey = timer?.key ?? null;
  const timerDelay = timer?.delay ?? null;
  const timerAction = timer?.action.type ?? null;
  timedActionRef.current = timer?.action ?? null;

  useEffect(() => {
    function handleVisibilityChange() {
      setDocumentIsVisible(document.visibilityState !== "hidden");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!shouldReduceMotion) return;

    pausedTimerRef.current = null;
    dispatch({ type: "reduce-motion" });
  }, [shouldReduceMotion]);

  useEffect(() => {
    if (
      shouldReduceMotion
      || !documentIsVisible
      || timerKey === null
      || timerDelay === null
      || timerAction === null
    ) {
      return;
    }

    const pausedTimer = pausedTimerRef.current;
    const delay = pausedTimer?.key === timerKey ? pausedTimer.remaining : timerDelay;
    pausedTimerRef.current = null;

    const startedAt = Date.now();
    const timerId = window.setTimeout(() => {
      const action = timedActionRef.current;
      if (action?.type !== timerAction) return;

      pausedTimerRef.current = null;
      dispatch(action);
    }, Math.max(0, delay));

    return () => {
      window.clearTimeout(timerId);

      if (document.visibilityState === "hidden") {
        pausedTimerRef.current = {
          key: timerKey,
          remaining: Math.max(0, delay - (Date.now() - startedAt)),
        };
      }
    };
  }, [documentIsVisible, shouldReduceMotion, timerAction, timerDelay, timerKey]);

  const replay = useCallback(() => {
    if (shouldReduceMotion || !state.replayUnlocked) return;

    pausedTimerRef.current = null;
    dispatch({ type: "replay" });
  }, [shouldReduceMotion, state.replayUnlocked]);

  const transition = shouldReduceMotion ? instantTransition : heroDemoTransition;
  const topicVisible = isDemoStepVisible(state, "topic");
  const structureVisible = isDemoStepVisible(state, "structure");
  const speechVisible = isDemoStepVisible(state, "speech");
  const slidesVisible = isDemoStepVisible(state, "slides");
  const readyVisible = isDemoStepVisible(state, "ready");
  const currentStatus = getCurrentStatusLabel(state);

  return (
    <figure
      className={cn("hero-generation-demo", className)}
      data-demo-phase={state.step}
      data-demo-status={state.status}
      data-testid="hero-generation-demo"
      aria-describedby={summaryId}
    >
      <figcaption className="hero-demo-caption">Как одна тема превращается в готовое выступление</figcaption>
      <p id={summaryId} style={visuallyHidden}>
        Декоративная демонстрация Lazyum: тема «Как искусственный интеллект меняет образование»
        превращается в план, текст речи, восемь слайдов и готовый комплект за 4 минуты 48 секунд.
      </p>

      <ol className="hero-demo-progress" aria-label="Этапы демонстрации">
        {heroDemoSteps.map((step) => {
          const Icon = stageIcons[step];
          const complete = hasReachedHeroDemoStep(state.step, step);
          const active = state.step === step;

          return (
            <li
              className={cn(
                "hero-demo-progress-step",
                complete && "hero-demo-progress-step-complete",
                active && "hero-demo-progress-step-active",
              )}
              key={step}
              aria-current={active ? "step" : undefined}
            >
              <Icon aria-hidden="true" size={14} strokeWidth={2.4} />
              <span>{heroDemoStepLabels[step]}</span>
            </li>
          );
        })}
      </ol>

      <div className="hero-demo-canvas" aria-hidden="true">
        <motion.div
          className="hero-demo-topic"
          initial={false}
          animate={{
            opacity: topicVisible ? 1 : 0.42,
            y: topicVisible ? 0 : 8,
            clipPath: topicVisible ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)",
          }}
          transition={transition}
        >
          <span className="hero-demo-topic-label">Тема выступления</span>
          <strong className="hero-demo-topic-value">Как искусственный интеллект меняет образование</strong>
        </motion.div>

        <div className="hero-demo-intermediate">
          <motion.article
            className="hero-demo-outline"
            initial={false}
            animate={revealArtifact(structureVisible, 10)}
            transition={transition}
          >
            <div className="hero-demo-artifact-heading"><FileText size={16} /><span>План и источники</span></div>
            <ol>
              <li>Что меняется в учёбе</li>
              <li>Где AI помогает студенту</li>
              <li>Как сохранить самостоятельность</li>
            </ol>
            <span className="hero-demo-source-count">3 опоры для выступления</span>
          </motion.article>

          <motion.article
            className="hero-demo-speech-preview"
            initial={false}
            animate={revealArtifact(speechVisible, 10)}
            transition={transition}
          >
            <div className="hero-demo-artifact-heading"><Mic2 size={16} /><span>Готовая речь</span></div>
            <p>«AI освобождает время для разбора сложных идей, а не заменяет обучение».</p>
          </motion.article>
        </div>

        <motion.div
          className="hero-demo-slide-stack"
          initial={false}
          animate={revealArtifact(slidesVisible, 12)}
          transition={transition}
        >
          {slidePreviews.map((slide, index) => (
            <motion.div
              className={slide.className}
              key={slide.label}
              initial={false}
              animate={{
                opacity: slidesVisible ? 1 : 0.2,
                x: slidesVisible ? index * 4 : 0,
                y: slidesVisible ? index * -4 : 8,
                rotate: slidesVisible ? (index - 1) * 1.5 : 0,
                scale: slidesVisible ? 1 : 0.98,
              }}
              transition={transition}
            >
              <span>{slide.label}</span>
              <strong>{slide.title}</strong>
            </motion.div>
          ))}

          <motion.div
            className="hero-demo-speech-sheet"
            initial={false}
            animate={{
              opacity: slidesVisible ? 1 : 0,
              x: slidesVisible ? 0 : -8,
              y: slidesVisible ? 0 : 8,
              rotate: slidesVisible ? -2 : 0,
            }}
            transition={transition}
          >
            <Mic2 size={15} />
            <span>Речь к слайдам</span>
          </motion.div>
        </motion.div>

        <motion.div
          className="hero-demo-ready"
          data-testid="hero-demo-ready"
          initial={false}
          animate={revealArtifact(readyVisible, 8)}
          transition={transition}
        >
          <Check aria-hidden="true" size={18} strokeWidth={3} />
          <div><strong>Готово за 4:48</strong><span>8 слайдов и текст речи</span></div>
        </motion.div>
      </div>

      <div className="hero-demo-controls">
        <span className="hero-demo-current-status" data-testid="hero-demo-status">{currentStatus}</span>
        {state.status !== "reduced-motion" ? (
          <motion.button
            className="hero-demo-replay"
            type="button"
            disabled={!state.replayUnlocked}
            onClick={replay}
            whileHover={state.replayUnlocked ? { y: -2 } : undefined}
            whileTap={state.replayUnlocked ? { y: 0 } : undefined}
            transition={transitions.control}
            data-testid="hero-demo-replay"
          >
            <RefreshCw aria-hidden="true" size={15} />
            Повторить
          </motion.button>
        ) : null}
      </div>
    </figure>
  );
}

function isDemoStepVisible(state: HeroDemoState, step: HeroDemoStep) {
  return state.status !== "waiting" && hasReachedHeroDemoStep(state.step, step);
}

function revealArtifact(visible: boolean, offset: number) {
  return {
    opacity: visible ? 1 : 0.16,
    y: visible ? 0 : offset,
    filter: visible ? "blur(0px)" : "blur(2px)",
  };
}

function getCurrentStatusLabel(state: HeroDemoState) {
  if (state.status === "waiting") return "Собираем путь от темы до готовой речи";
  if (state.status === "reduced-motion") return "Готовый комплект: 8 слайдов и речь";
  if (state.step === "ready") return state.replayUnlocked ? "Готово — можно посмотреть ещё раз" : "Готовый комплект остаётся на экране";

  return `Собираем: ${heroDemoStepLabels[state.step].toLocaleLowerCase("ru-RU")}`;
}
