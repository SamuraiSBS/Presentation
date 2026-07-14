import { describe, expect, it } from "vitest";
import {
  createInitialHeroDemoState,
  getHeroDemoTimer,
  heroDemoActiveDurationMs,
  heroDemoReducer,
  heroDemoTimingMs,
} from "./hero-generation-demo";

describe("hero generation demo state machine", () => {
  it("moves through the local topic-to-ready story in order", () => {
    let state = createInitialHeroDemoState();

    expect(getHeroDemoTimer(state)).toMatchObject({
      key: "start:0",
      delay: heroDemoTimingMs.initialDelay,
      action: { type: "start" },
    });

    state = heroDemoReducer(state, { type: "start" });
    expect(state).toMatchObject({ step: "topic", status: "running" });

    for (const expectedStep of ["structure", "speech", "slides", "ready"] as const) {
      state = heroDemoReducer(state, { type: "advance" });
      expect(state.step).toBe(expectedStep);
    }

    expect(state).toMatchObject({ status: "ready", replayUnlocked: false });
    expect(getHeroDemoTimer(state)).toMatchObject({
      key: "ready:0",
      delay: heroDemoTimingMs.readyHold,
      action: { type: "unlock-replay" },
    });
  });

  it("keeps the result on screen before allowing an explicit replay", () => {
    let state = createInitialHeroDemoState();
    state = heroDemoReducer(state, { type: "start" });
    state = heroDemoReducer(state, { type: "advance" });
    state = heroDemoReducer(state, { type: "advance" });
    state = heroDemoReducer(state, { type: "advance" });
    state = heroDemoReducer(state, { type: "advance" });

    expect(heroDemoReducer(state, { type: "replay" })).toBe(state);

    state = heroDemoReducer(state, { type: "unlock-replay" });
    state = heroDemoReducer(state, { type: "replay" });

    expect(state).toEqual({
      step: "topic",
      status: "running",
      cycle: 1,
      replayUnlocked: false,
    });
  });

  it("uses a four-to-six-second active story and a static reduced-motion result", () => {
    expect(heroDemoActiveDurationMs).toBeGreaterThanOrEqual(4_000);
    expect(heroDemoActiveDurationMs).toBeLessThanOrEqual(6_000);

    const reduced = heroDemoReducer(createInitialHeroDemoState(), { type: "reduce-motion" });
    expect(reduced).toEqual({
      step: "ready",
      status: "reduced-motion",
      cycle: 0,
      replayUnlocked: false,
    });
    expect(getHeroDemoTimer(reduced)).toBeNull();
  });
});
