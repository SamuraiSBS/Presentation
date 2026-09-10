import {
  aiScenePrototypeCostPolicy,
  type AiSceneCostEnvelopeBucket,
  type CostEnvelopePolicy,
} from "@studydeck/shared";

const CALL_LIMITS: Record<AiSceneCostEnvelopeBucket, number> = {
  style_direction: 1,
  slide_concept: 2,
  scene_analysis: 2,
  layer_generation: 2,
  scene_repair: 1,
};

type Reservation = { stage: AiSceneCostEnvelopeBucket; amountRub: string };

/**
 * Run-local hard cap for the two-slide stop/go prototype. Every paid stage
 * must reserve its own policy bucket before contacting the provider.
 */
export class AiScenePrototypeBudget {
  readonly policy: CostEnvelopePolicy;
  private readonly reservations = new Map<string, Reservation>();
  private readonly settledByStage = new Map<AiSceneCostEnvelopeBucket, string>();
  private readonly callsByStage = new Map<AiSceneCostEnvelopeBucket, number>();
  private readonly priorSettledRub: string;
  private blocked = false;

  constructor(policy = aiScenePrototypeCostPolicy(), priorSettledRub = "0") {
    if (!isAmount(priorSettledRub) || toUnits(priorSettledRub) > toUnits(policy.limitRub)) {
      throw new Error("ai_scene_prototype_prior_spend_invalid");
    }
    this.policy = policy;
    this.priorSettledRub = priorSettledRub;
  }

  reserve(key: string, stage: AiSceneCostEnvelopeBucket) {
    if (this.blocked) return { status: "ai_scene_prototype_budget_blocked" as const };
    if (this.reservations.has(key)) return { status: "ai_scene_prototype_reservation_duplicate" as const };
    const calls = this.callsByStage.get(stage) || 0;
    if (calls >= CALL_LIMITS[stage]) return { status: "ai_scene_prototype_stage_call_limit" as const };
    const bucket = this.policy.buckets[stage];
    if (!bucket) return { status: "ai_scene_prototype_policy_missing_bucket" as const };
    const settled = this.settledByStage.get(stage) || "0";
    const reserved = this.reservedForStage(stage);
    const available = subtract(subtract(bucket, settled), reserved);
    const remainingCalls = CALL_LIMITS[stage] - calls;
    const amountRub = divide(available, remainingCalls);
    if (toUnits(amountRub) <= 0n || toUnits(add(this.totalSettled(), this.totalReserved())) + toUnits(amountRub) > toUnits(this.policy.limitRub)) {
      this.blocked = true;
      return { status: "ai_scene_prototype_budget_exhausted_preflight" as const };
    }
    this.callsByStage.set(stage, calls + 1);
    this.reservations.set(key, { stage, amountRub });
    return { status: "reserved" as const, amountRub, stage, remainingBudgetRub: subtract(this.policy.limitRub, add(this.totalSettled(), this.totalReserved())) };
  }

  settle(key: string, actualCostRub: string | undefined) {
    const reservation = this.reservations.get(key);
    if (!reservation || !isAmount(actualCostRub)) {
      this.blocked = true;
      return { status: "ai_scene_prototype_cost_unavailable" as const };
    }
    this.reservations.delete(key);
    const stageSettled = add(this.settledByStage.get(reservation.stage) || "0", actualCostRub);
    const totalSettled = add(this.totalSettled(), actualCostRub);
    const overrun = toUnits(actualCostRub) > toUnits(reservation.amountRub)
      || toUnits(stageSettled) > toUnits(this.policy.buckets[reservation.stage]!)
      || toUnits(totalSettled) > toUnits(this.policy.limitRub);
    this.settledByStage.set(reservation.stage, stageSettled);
    if (overrun) this.blocked = true;
    return {
      status: overrun ? "ai_scene_prototype_budget_overrun" as const : "settled" as const,
      actualCostRub,
      stage: reservation.stage,
      remainingBudgetRub: subtract(this.policy.limitRub, totalSettled),
    };
  }

  snapshot() {
    return {
      policy: this.policy,
      priorSettledRub: this.priorSettledRub,
      settledByStage: Object.fromEntries(this.settledByStage),
      settledRub: this.totalSettled(),
      blocked: this.blocked,
    };
  }

  private reservedForStage(stage: AiSceneCostEnvelopeBucket) {
    return [...this.reservations.values()]
      .filter((reservation) => reservation.stage === stage)
      .reduce((sum, reservation) => add(sum, reservation.amountRub), "0");
  }

  private totalReserved() {
    return [...this.reservations.values()].reduce((sum, reservation) => add(sum, reservation.amountRub), "0");
  }

  private totalSettled() {
    return [...this.settledByStage.values()].reduce(add, this.priorSettledRub);
  }
}

function isAmount(value: string | undefined): value is string {
  return Boolean(value && /^\d+(?:\.\d+)?$/.test(value) && toUnits(value) >= 0n);
}

function toUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(`${fraction}00000000`.slice(0, 8));
}

function fromUnits(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100_000_000n}.${(absolute % 100_000_000n).toString().padStart(8, "0")}`;
}

function add(left: string, right: string) { return fromUnits(toUnits(left) + toUnits(right)); }
function subtract(left: string, right: string) { return fromUnits(toUnits(left) - toUnits(right)); }
function divide(value: string, divisor: number) { return fromUnits(toUnits(value) / BigInt(divisor)); }
