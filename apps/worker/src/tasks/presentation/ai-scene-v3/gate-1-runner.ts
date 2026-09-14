import {
  AI_SCENE_V3_GATE_1_COST_POLICY,
  costEnvelopePolicyIsValid,
  type CandidateQualityReportV3,
  type CompositionPlanV3,
  type CostEnvelopePolicy,
  type DeckArtDirectionV3,
  type ProviderCapabilitySnapshot,
  type SlideSemanticBriefV3,
} from "@studydeck/shared";
import { generateAitunnelImage } from "../../../aitunnel-image.js";
import { generateAiSceneV3Background } from "./background-generator.js";
import { validateAiSceneV3CompositionPair } from "./composition-planner.js";
import { inspectAiSceneV3Candidate } from "./candidate-quality.js";
import { renderAiSceneV3Candidate } from "./candidate-renderer.js";
import { validateAiSceneV3TextLayout, aiSceneV3TextLayoutPrompt } from "./text-layout-analyzer.js";
import { aiSceneV3VisionQualityPrompt, validateAiSceneV3VisionReview } from "./vision-quality.js";

type EnvLike = Record<string, string | undefined>;
type RubStage = "backgrounds" | "native_text_layout" | "high_detail_vision";

const STAGE_RESERVATION: Record<RubStage, string> = {
  backgrounds: "15.00000000",
  native_text_layout: "4.00000000",
  high_detail_vision: "6.00000000",
};

/** A separately authorised one-candidate retry cannot reserve the six-candidate envelope. */
export const AI_SCENE_V3_GATE_1_SINGLE_CANDIDATE_COST_POLICY: CostEnvelopePolicy = {
  version: "ai-scene-v3-gate-1-single-candidate-v1",
  limitRub: "25.00000000",
  buckets: { backgrounds: "15.00000000", native_text_layout: "4.00000000", high_detail_vision: "6.00000000" },
};

export type AiSceneV3Gate1Topic = {
  id: string;
  brief: SlideSemanticBriefV3;
  artDirection: DeckArtDirectionV3;
  plans: readonly [CompositionPlanV3, CompositionPlanV3];
  references: readonly { id: string; url: string }[];
};

export type AiSceneV3Gate1CandidateManifest = {
  topic: string;
  variant: "A" | "B";
  compositionType: CompositionPlanV3["compositionType"];
  status: "passed" | "failed";
  cost: { backgroundRub?: string; nativeTextLayoutRub?: string; highDetailVisionRub?: string; uncertainUpperBoundRub?: string };
  artifacts?: { backgroundObjectKey?: string; renderedPreviewObjectKey?: string };
  qualityReport?: CandidateQualityReportV3;
  diagnostics: string[];
};

export type AiSceneV3Gate1Manifest = {
  version: 3;
  gate: "gate_1";
  status: "review_required" | "failed";
  stopGo: "no_go_pending_human_review";
  policy: CostEnvelopePolicy;
  reservedRub: string;
  actualRub: string;
  uncertainRub: string;
  candidates: AiSceneV3Gate1CandidateManifest[];
  diagnostics: string[];
};

type BackgroundArtifactLocation = { backgroundObjectKey: string; url: string };
type PreviewArtifactLocation = { renderedPreviewObjectKey: string };

type Gate1Dependencies = {
  generate?: typeof generateAitunnelImage;
  nativeTextLayout(input: { prompt: string; background: Buffer; brief: SlideSemanticBriefV3; plan: CompositionPlanV3; artDirection: DeckArtDirectionV3 }): Promise<{ value: unknown; costRub?: string }>;
  highDetailVision(input: { prompt: string; background: Buffer; preview: Buffer; brief: SlideSemanticBriefV3; plan: CompositionPlanV3 }): Promise<{ value: unknown; costRub?: string }>;
  saveBackground(input: { topic: AiSceneV3Gate1Topic; plan: CompositionPlanV3; background: Buffer }): Promise<BackgroundArtifactLocation>;
  savePreview(input: { topic: AiSceneV3Gate1Topic; plan: CompositionPlanV3; preview: Buffer }): Promise<PreviewArtifactLocation>;
  assertExportCompatibility(input: { canvas: Awaited<ReturnType<typeof renderAiSceneV3Candidate>>["canvas"]; background: Buffer }): Promise<boolean>;
  onProgress?: (manifest: AiSceneV3Gate1Manifest) => Promise<void> | void;
};

/**
 * Executes the complete Gate 1 candidate contract. It never creates C and it
 * never turns a technical pass into GO: human comparative review remains the
 * only way to change the stop/go verdict after this function returns.
 */
export async function runAiSceneV3Gate1(input: {
  env: EnvLike;
  capabilities: ProviderCapabilitySnapshot;
  topics: readonly AiSceneV3Gate1Topic[];
  policy?: CostEnvelopePolicy;
  /** A separately authorised diagnostic retry may stop after one A/B candidate. */
  candidateLimit?: number;
}, dependencies: Gate1Dependencies): Promise<AiSceneV3Gate1Manifest> {
  const policy = validateGate1Policy(input.policy || AI_SCENE_V3_GATE_1_COST_POLICY);
  const budget = new AiSceneV3Gate1Budget(policy);
  const manifest: AiSceneV3Gate1Manifest = {
    version: 3,
    gate: "gate_1",
    status: "review_required",
    stopGo: "no_go_pending_human_review",
    policy,
    reservedRub: "0.00000000",
    actualRub: "0.00000000",
    uncertainRub: "0.00000000",
    candidates: [],
    diagnostics: [],
  };
  const publish = async () => {
    manifest.reservedRub = budget.reservedRub;
    manifest.actualRub = budget.actualRub;
    manifest.uncertainRub = budget.uncertainRub;
    await dependencies.onProgress?.(structuredClone(manifest));
  };

  try {
    if (input.topics.length !== 3) throw new Error("ai_scene_v3_gate_1_exactly_three_topics_required");
    if (new Set(input.topics.map((topic) => topic.id)).size !== input.topics.length) throw new Error("ai_scene_v3_gate_1_topic_ids_duplicate");
    const candidateLimit = input.candidateLimit ?? 6;
    if (!Number.isInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > 6) throw new Error("ai_scene_v3_gate_1_candidate_limit_invalid");
    topics: for (const topic of input.topics) {
      const [a, b] = validateAiSceneV3CompositionPair(topic.plans[0], topic.plans[1], topic.brief);
      for (const plan of [a, b]) {
        const candidate = emptyCandidate(topic, plan);
        manifest.candidates.push(candidate);
        await publish();
        await runCandidate({ input, topic, plan, budget, dependencies, result: candidate, publish });
        await publish();
        if (candidate.status === "failed") {
          manifest.status = "failed";
          manifest.diagnostics.push("candidate_failed_hard_stop_remaining_gate_1_candidates_not_started");
          break topics;
        }
        if (manifest.candidates.length >= candidateLimit) {
          manifest.diagnostics.push("candidate_limit_reached_no_remaining_candidates_started");
          break topics;
        }
      }
    }
    if (manifest.candidates.some((candidate) => candidate.status === "failed")) {
      manifest.status = "failed";
      manifest.diagnostics.push("one_or_more_candidates_failed_hard_gate");
    }
  } catch (error) {
    manifest.status = "failed";
    manifest.diagnostics.push(errorMessage(error));
  }
  await publish();
  return manifest;
}

async function runCandidate(input: {
  input: { env: EnvLike; capabilities: ProviderCapabilitySnapshot };
  topic: AiSceneV3Gate1Topic;
  plan: CompositionPlanV3;
  budget: AiSceneV3Gate1Budget;
  dependencies: Gate1Dependencies;
  result: AiSceneV3Gate1CandidateManifest;
  publish: () => Promise<void>;
}): Promise<void> {
  const result = input.result;
  let unsettledStage: RubStage | undefined;
  let operation = "backgrounds";
  try {
    input.budget.reserve("backgrounds");
    unsettledStage = "backgrounds";
    const background = await generateAiSceneV3Background({
      env: input.input.env,
      capabilities: input.input.capabilities,
      artDirection: input.topic.artDirection,
      brief: input.topic.brief,
      plan: input.plan,
      references: input.topic.references,
    }, input.dependencies.generate ? { generate: input.dependencies.generate as never } : {});
    result.cost.backgroundRub = input.budget.settle("backgrounds", background.costRub);
    unsettledStage = undefined;
    operation = "background_artifact";
    const backgroundArtifact = await input.dependencies.saveBackground({ topic: input.topic, plan: input.plan, background: background.buffer });
    result.artifacts = { backgroundObjectKey: backgroundArtifact.backgroundObjectKey };
    await input.publish();

    operation = "native_text_layout";
    input.budget.reserve("native_text_layout");
    unsettledStage = "native_text_layout";
    const layoutResponse = await input.dependencies.nativeTextLayout({
      prompt: aiSceneV3TextLayoutPrompt({ brief: input.topic.brief, plan: input.plan, artDirection: input.topic.artDirection, backgroundWidth: background.dimensions.width, backgroundHeight: background.dimensions.height }),
      background: background.buffer,
      brief: input.topic.brief,
      plan: input.plan,
      artDirection: input.topic.artDirection,
    });
    result.cost.nativeTextLayoutRub = input.budget.settle("native_text_layout", layoutResponse.costRub);
    unsettledStage = undefined;
    const layout = validateAiSceneV3TextLayout({ value: layoutResponse.value, brief: input.topic.brief, plan: input.plan, artDirection: input.topic.artDirection });
    const rendered = await renderAiSceneV3Candidate({
      background: { buffer: background.buffer, objectKey: "pending", url: "https://gate-1.local/pending.png", alt: input.topic.brief.title.text, contentType: "image/png" },
      layout,
      textValues: nativeTextValues(input.topic.brief),
      backgroundColor: input.topic.artDirection.palette.background,
    });
    operation = "preview_artifact";
    const previewArtifact = await input.dependencies.savePreview({ topic: input.topic, plan: input.plan, preview: rendered.preview });
    result.artifacts = { ...result.artifacts, renderedPreviewObjectKey: previewArtifact.renderedPreviewObjectKey };
    await input.publish();
    const renderedWithArtifactKeys = await renderAiSceneV3Candidate({
      background: { buffer: background.buffer, objectKey: backgroundArtifact.backgroundObjectKey, url: backgroundArtifact.url, alt: input.topic.brief.title.text, contentType: "image/png" },
      layout,
      textValues: nativeTextValues(input.topic.brief),
      backgroundColor: input.topic.artDirection.palette.background,
    });

    operation = "high_detail_vision";
    input.budget.reserve("high_detail_vision");
    unsettledStage = "high_detail_vision";
    const visionResponse = await input.dependencies.highDetailVision({
      prompt: aiSceneV3VisionQualityPrompt({ brief: input.topic.brief, plan: input.plan, backgroundWidth: background.dimensions.width, backgroundHeight: background.dimensions.height }),
      background: background.buffer,
      preview: renderedWithArtifactKeys.preview,
      brief: input.topic.brief,
      plan: input.plan,
    });
    result.cost.highDetailVisionRub = input.budget.settle("high_detail_vision", visionResponse.costRub);
    unsettledStage = undefined;
    const vision = validateAiSceneV3VisionReview(visionResponse.value, input.topic.brief, input.plan);
    const exportCompatible = await input.dependencies.assertExportCompatibility({ canvas: renderedWithArtifactKeys.canvas, background: background.buffer });
    const report = await inspectAiSceneV3Candidate({
      background: background.buffer,
      canvas: renderedWithArtifactKeys.canvas,
      brief: input.topic.brief,
      plan: input.plan,
      layout,
      backgroundSaved: true,
      renderedPreviewSaved: true,
      exportCompatible,
      vision,
    });
    result.qualityReport = report;
    result.diagnostics.push(...report.diagnostics);
    result.status = report.passed ? "passed" : "failed";
  } catch (error) {
    const reportedCost = providerReportedCost(error);
    if (unsettledStage && reportedCost) {
      const settled = input.budget.settle(unsettledStage, reportedCost);
      if (unsettledStage === "backgrounds") result.cost.backgroundRub = settled;
      if (unsettledStage === "native_text_layout") result.cost.nativeTextLayoutRub = settled;
      if (unsettledStage === "high_detail_vision") result.cost.highDetailVisionRub = settled;
    } else if (unsettledStage) {
      result.cost.uncertainUpperBoundRub = input.budget.markUncertain(unsettledStage);
    }
    result.diagnostics.push(stageDiagnostic(operation, error));
    await input.publish();
  }
}

function emptyCandidate(topic: AiSceneV3Gate1Topic, plan: CompositionPlanV3): AiSceneV3Gate1CandidateManifest {
  return { topic: topic.id, variant: plan.variant as "A" | "B", compositionType: plan.compositionType, status: "failed", cost: {}, diagnostics: [] };
}

export class AiSceneV3Gate1Budget {
  private readonly reservedByStage = new Map<RubStage, bigint>();
  private readonly actualByStage = new Map<RubStage, bigint>();

  constructor(readonly policy: CostEnvelopePolicy) { validateGate1Policy(policy); }

  get reservedRub() { return formatRub(sum(this.reservedByStage.values())); }
  get actualRub() { return formatRub(sum(this.actualByStage.values())); }
  get uncertainRub() { return formatRub(sum([...this.openReservations.values()].flat())); }
  private readonly openReservations = new Map<RubStage, bigint[]>();

  reserve(stage: RubStage) {
    const amount = rubUnits(STAGE_RESERVATION[stage]);
    const next = (this.reservedByStage.get(stage) || 0n) + amount;
    if (next > rubUnits(this.policy.buckets[stage]!)) throw new Error(`ai_scene_v3_gate_1_${stage}_envelope_exhausted`);
    if (sum(this.reservedByStage.values()) + amount > rubUnits(this.policy.limitRub)) throw new Error("ai_scene_v3_gate_1_envelope_exhausted");
    this.reservedByStage.set(stage, next);
    const open = this.openReservations.get(stage) || [];
    open.push(amount);
    this.openReservations.set(stage, open);
  }

  settle(stage: RubStage, actualRub: string | undefined) {
    if (!actualRub || !/^\d+(?:\.\d+)?$/.test(actualRub)) throw new Error(`ai_scene_v3_gate_1_${stage}_cost_unavailable`);
    const actual = rubUnits(actualRub);
    const open = this.openReservations.get(stage);
    const reserved = open?.at(-1);
    const settled = this.actualByStage.get(stage) || 0n;
    if (reserved === undefined || actual > reserved || settled + actual > rubUnits(this.policy.buckets[stage]!)) throw new Error(`ai_scene_v3_gate_1_${stage}_cost_overrun`);
    open!.pop();
    this.actualByStage.set(stage, settled + actual);
    return formatRub(actual);
  }

  /** Retains a failed provider call's reservation as an explicit spend upper bound. */
  markUncertain(stage: RubStage) {
    const reserved = this.openReservations.get(stage)?.at(-1);
    if (reserved === undefined) throw new Error(`ai_scene_v3_gate_1_${stage}_uncertain_reservation_missing`);
    return formatRub(reserved);
  }
}

function validateGate1Policy(policy: CostEnvelopePolicy) {
  if (!costEnvelopePolicyIsValid(policy)) throw new Error("ai_scene_v3_gate_1_cost_policy_invalid");
  const accepted = policy.version === AI_SCENE_V3_GATE_1_COST_POLICY.version
    ? AI_SCENE_V3_GATE_1_COST_POLICY
    : policy.version === AI_SCENE_V3_GATE_1_SINGLE_CANDIDATE_COST_POLICY.version
    ? AI_SCENE_V3_GATE_1_SINGLE_CANDIDATE_COST_POLICY
    : undefined;
  if (!accepted || policy.limitRub !== accepted.limitRub) throw new Error("ai_scene_v3_gate_1_cost_policy_invalid");
  for (const stage of Object.keys(STAGE_RESERVATION) as RubStage[]) {
    if (policy.buckets[stage] !== accepted.buckets[stage]) throw new Error("ai_scene_v3_gate_1_cost_policy_invalid");
  }
  return { version: policy.version, limitRub: policy.limitRub, buckets: { ...policy.buckets } };
}

function nativeTextValues(brief: SlideSemanticBriefV3) {
  return [
    { semanticId: "title", value: brief.title },
    ...brief.anchors.map((anchor) => ({ semanticId: anchor.id, value: { text: anchor.text } })),
    ...(brief.conclusion ? [{ semanticId: "conclusion", value: brief.conclusion }] : []),
  ];
}

function rubUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(`${fraction}00000000`.slice(0, 8));
}
function formatRub(value: bigint) { return `${value / 100_000_000n}.${(value % 100_000_000n).toString().padStart(8, "0")}`; }
function sum(values: Iterable<bigint>) { let total = 0n; for (const value of values) total += value; return total; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function stageDiagnostic(operation: string, error: unknown) {
  const diagnostic = error && typeof error === "object" ? (error as { diagnostic?: unknown }).diagnostic : undefined;
  return typeof diagnostic === "string" && diagnostic.trim()
    ? diagnostic
    : `ai_scene_v3_gate_1_${operation}_failed:${errorMessage(error)}`;
}
function providerReportedCost(error: unknown) {
  const value = error && typeof error === "object" ? (error as { costRub?: unknown }).costRub : undefined;
  return typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? value : undefined;
}
