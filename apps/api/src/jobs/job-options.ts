export function generationJobOptions() {
  return {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 60 * 60 * 24, count: 100 },
    removeOnFail: { age: 60 * 60 * 24 * 7, count: 200 },
  };
}

export function narrationJobOptions() {
  return {
    attempts: 1,
    removeOnComplete: { age: 60 * 60 * 24, count: 100 },
    removeOnFail: { age: 60 * 60 * 24 * 7, count: 200 },
  };
}
