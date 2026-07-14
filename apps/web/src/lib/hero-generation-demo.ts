export const heroDemoSteps = ["topic", "structure", "speech", "slides", "ready"] as const;

export type HeroDemoStep = (typeof heroDemoSteps)[number];

export const heroDemoStepLabels: Record<HeroDemoStep, string> = {
  topic: "Тема",
  structure: "План",
  speech: "Речь",
  slides: "Слайды",
  ready: "Готово",
};

export const heroDemoTimingMs = {
  initialDelay: 420,
  topic: 900,
  structure: 1_000,
  speech: 1_000,
  slides: 1_100,
  readyHold: 6_400,
} as const;

export const heroDemoActiveDurationMs =
  heroDemoTimingMs.topic
  + heroDemoTimingMs.structure
  + heroDemoTimingMs.speech
  + heroDemoTimingMs.slides;

export type HeroDemoStatus = "waiting" | "running" | "ready" | "reduced-motion";

export type HeroDemoState = {
  step: HeroDemoStep;
  status: HeroDemoStatus;
  cycle: number;
  replayUnlocked: boolean;
};

export const initialHeroDemoState: HeroDemoState = {
  step: "topic",
  status: "waiting",
  cycle: 0,
  replayUnlocked: false,
};

export function createInitialHeroDemoState(): HeroDemoState {
  return { ...initialHeroDemoState };
}

export type HeroDemoAction =
  | { type: "start" }
  | { type: "advance" }
  | { type: "unlock-replay" }
  | { type: "replay" }
  | { type: "reduce-motion" };

export type HeroDemoTimedAction = Exclude<HeroDemoAction, { type: "replay" | "reduce-motion" }>;

export type HeroDemoTimer = {
  key: string;
  delay: number;
  action: HeroDemoTimedAction;
};

export function heroDemoReducer(state: HeroDemoState, action: HeroDemoAction): HeroDemoState {
  switch (action.type) {
    case "start":
      return state.status === "waiting"
        ? { ...state, status: "running" }
        : state;
    case "advance": {
      if (state.status !== "running") return state;

      const nextStep = heroDemoSteps[getHeroDemoStepIndex(state.step) + 1];
      if (!nextStep) return state;

      return {
        ...state,
        step: nextStep,
        status: nextStep === "ready" ? "ready" : "running",
        replayUnlocked: false,
      };
    }
    case "unlock-replay":
      return state.status === "ready" && !state.replayUnlocked
        ? { ...state, replayUnlocked: true }
        : state;
    case "replay":
      return state.status === "ready" && state.replayUnlocked
        ? {
            step: "topic",
            status: "running",
            cycle: state.cycle + 1,
            replayUnlocked: false,
          }
        : state;
    case "reduce-motion":
      return state.status === "reduced-motion" && state.step === "ready"
        ? state
        : {
            step: "ready",
            status: "reduced-motion",
            cycle: state.cycle,
            replayUnlocked: false,
          };
  }
}

export function getHeroDemoStepIndex(step: HeroDemoStep) {
  return heroDemoSteps.indexOf(step);
}

export function hasReachedHeroDemoStep(currentStep: HeroDemoStep, targetStep: HeroDemoStep) {
  return getHeroDemoStepIndex(currentStep) >= getHeroDemoStepIndex(targetStep);
}

export function getHeroDemoTimer(state: HeroDemoState): HeroDemoTimer | null {
  if (state.status === "waiting") {
    return {
      key: `start:${state.cycle}`,
      delay: heroDemoTimingMs.initialDelay,
      action: { type: "start" },
    };
  }

  if (state.status === "running" && state.step !== "ready") {
    return {
      key: `step:${state.cycle}:${state.step}`,
      delay: heroDemoTimingMs[state.step],
      action: { type: "advance" },
    };
  }

  if (state.status === "ready" && !state.replayUnlocked) {
    return {
      key: `ready:${state.cycle}`,
      delay: heroDemoTimingMs.readyHold,
      action: { type: "unlock-replay" },
    };
  }

  return null;
}
