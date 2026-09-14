import {
  generateAitunnelImage,
  type GeneratedAitunnelImage,
} from "../../../aitunnel-image.js";
import {
  AI_SCENE_V3_MAX_REFERENCE_IMAGES,
  aiSceneV3ImageEnv,
  assertAiSceneV3ProviderPreflight,
  fetchAiSceneV3ProviderCapabilities,
  verifyAiSceneV3GeneratedPng,
  type AiSceneV3ImageRequest,
} from "./provider-preflight.js";

type EnvLike = Record<string, string | undefined>;

export type AiSceneV3Gate0Manifest = {
  version: 1;
  gate: "gate_0_provider_smoke";
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  provider: "aitunnel";
  request?: AiSceneV3ImageRequest;
  references?: { count: number; inputReferencesSent: boolean };
  capabilities?: Awaited<ReturnType<typeof fetchAiSceneV3ProviderCapabilities>>;
  returned?: { contentType: string; width: number; height: number; model: string; providerRequestId?: string };
  cost: { ceilingRub: string; reservedRub: string; actualRub?: string; status: "not_reserved" | "reserved" | "settled" | "cost_unavailable" | "ceiling_exceeded" };
  durationMs: number;
  diagnostics: string[];
};

type Gate0Dependencies = {
  fetchCapabilities?: typeof fetchAiSceneV3ProviderCapabilities;
  generate?: typeof generateAitunnelImage;
  now?: () => Date;
};

/** One-run cost guard for the explicit, user-authorised Gate 0 smoke. */
export class AiSceneV3Gate0Budget {
  private reserved = false;

  constructor(readonly ceilingRub: string) {
    if (!isRubAmount(ceilingRub) || toUnits(ceilingRub) <= 0n) throw new Error("ai_scene_v3_gate_0_invalid_ceiling");
  }

  reserve() {
    if (this.reserved) return { status: "ceiling_exceeded" as const, reservedRub: "0" };
    this.reserved = true;
    return { status: "reserved" as const, reservedRub: normalizeRub(this.ceilingRub) };
  }

  settle(actualRub: string | undefined) {
    if (!isRubAmount(actualRub)) return { status: "cost_unavailable" as const, actualRub: undefined };
    const normalized = normalizeRub(actualRub);
    return toUnits(normalized) <= toUnits(this.ceilingRub)
      ? { status: "settled" as const, actualRub: normalized }
      : { status: "ceiling_exceeded" as const, actualRub: normalized };
  }
}

/**
 * Performs exactly one real provider call after all non-billable checks pass.
 * The returned manifest intentionally contains no image buffer or API secret.
 */
export async function runAiSceneV3Gate0Smoke(input: {
  env: EnvLike;
  ceilingRub: string;
  prompt?: string;
  /** Provider-readable URLs. They are deliberately never written to the manifest. */
  referenceUrls: readonly string[];
  /**
   * Optional local-only persistence hook. It runs only after PNG and dimension
   * verification, so visual review can inspect the exact billable result.
   */
  onVerifiedImage?: (image: GeneratedAitunnelImage, dimensions: { width: number; height: number }) => Promise<void> | void;
}, dependencies: Gate0Dependencies = {}): Promise<AiSceneV3Gate0Manifest> {
  const now = dependencies.now || (() => new Date());
  const started = now();
  const budget = new AiSceneV3Gate0Budget(input.ceilingRub);
  const manifest: Omit<AiSceneV3Gate0Manifest, "status" | "completedAt" | "durationMs" | "diagnostics"> = {
    version: 1,
    gate: "gate_0_provider_smoke",
    startedAt: started.toISOString(),
    provider: "aitunnel",
    cost: { ceilingRub: normalizeRub(input.ceilingRub), reservedRub: "0", status: "not_reserved" },
  };

  try {
    const capabilities = await (dependencies.fetchCapabilities || fetchAiSceneV3ProviderCapabilities)(input.env);
    const preflight = assertAiSceneV3ProviderPreflight(input.env, capabilities);
    manifest.capabilities = capabilities;
    manifest.request = preflight.request;
    const references = gate0References(input.referenceUrls);
    manifest.references = { count: references.length, inputReferencesSent: true };
    const reservation = budget.reserve();
    manifest.cost = { ceilingRub: normalizeRub(input.ceilingRub), reservedRub: reservation.reservedRub, status: reservation.status };
    if (reservation.status !== "reserved") throw new Error("ai_scene_v3_gate_0_cost_reservation_failed");

    const generated = await (dependencies.generate || generateAitunnelImage)(input.prompt || defaultGate0Prompt(), aiSceneV3ImageEnv(input.env), {
      purpose: "ai_scene_v3_background",
      inputReferences: references,
    });
    const dimensions = await verifyAiSceneV3GeneratedPng({ buffer: generated.buffer, contentType: generated.contentType, request: preflight.request });
    const settlement = budget.settle(generated.costRub);
    manifest.returned = returnedImage(generated, dimensions);
    manifest.cost = {
      ceilingRub: normalizeRub(input.ceilingRub),
      reservedRub: reservation.reservedRub,
      actualRub: settlement.actualRub,
      status: settlement.status,
    };
    if (settlement.status !== "settled") throw new Error(`ai_scene_v3_gate_0_${settlement.status}`);
    await input.onVerifiedImage?.(generated, dimensions);

    return completeManifest(manifest, "passed", now(), []);
  } catch (error) {
    return completeManifest(manifest, "failed", now(), [error instanceof Error ? error.message : String(error)]);
  }
}

function completeManifest(
  partial: Omit<AiSceneV3Gate0Manifest, "status" | "completedAt" | "durationMs" | "diagnostics">,
  status: AiSceneV3Gate0Manifest["status"],
  completedAt: Date,
  diagnostics: string[],
): AiSceneV3Gate0Manifest {
  return {
    ...partial,
    status,
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - new Date(partial.startedAt).getTime()),
    diagnostics,
  };
}

function returnedImage(image: GeneratedAitunnelImage, dimensions: { width: number; height: number }) {
  return { contentType: image.contentType, ...dimensions, model: image.model, ...(image.providerRequestId ? { providerRequestId: image.providerRequestId } : {}) };
}

function defaultGate0Prompt() {
  return [
    "Create a single polished 16:9 presentation background for a scientific slide about the Solar System.",
    "Show a luminous sun, distinct planets on clearly separated orbital paths, depth, accurate relative grouping, and calm dark areas reserved for native overlay text.",
    "No text, no letters, no numbers, no labels, no logos, no watermarks, and no readable symbols anywhere in the image.",
  ].join(" ");
}

function gate0References(urls: readonly string[]) {
  const normalized = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  if (normalized.length < 1 || normalized.length > AI_SCENE_V3_MAX_REFERENCE_IMAGES) {
    throw new Error("ai_scene_v3_gate_0_input_reference_required");
  }
  if (normalized.some((url) => !/^https?:\/\//i.test(url))) {
    throw new Error("ai_scene_v3_gate_0_provider_readable_reference_required");
  }
  return normalized.map((url) => ({ type: "image_url" as const, image_url: { url } }));
}

function isRubAmount(value: string | undefined): value is string {
  return Boolean(value && /^\d+(?:\.\d+)?$/.test(value));
}

function toUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(`${fraction}00000000`.slice(0, 8));
}

function normalizeRub(value: string) {
  const units = toUnits(value);
  return `${units / 100_000_000n}.${(units % 100_000_000n).toString().padStart(8, "0")}`;
}
