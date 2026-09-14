import sharp from "sharp";
import {
  providerCapabilitySnapshotSchema,
  type ProviderCapabilitySnapshot,
} from "@studydeck/shared";
import { aitunnelImageConfig, type AitunnelImageConfig } from "../../../aitunnel-image.js";
import { createAitunnelFetch } from "../../../openai-client.js";
import { aiSceneImageEnv } from "../ai-scene/image-timeout.js";

type EnvLike = Record<string, string | undefined>;
type FetchResponse = { ok: boolean; status: number; text(): Promise<string> };
type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

export const AI_SCENE_V3_IMAGE_MODEL = "gpt-image-2.5-flare";
export const AITUNNEL_IMAGE_CAPABILITIES_URL = "https://api.aitunnel.ru/public/aitunnel/models/images";
export const AI_SCENE_V3_MAX_REFERENCE_IMAGES = 3;
export const AI_SCENE_V3_CAPABILITIES_TIMEOUT_MS = 20_000;

export type AiSceneV3ImageRequest = {
  model: typeof AI_SCENE_V3_IMAGE_MODEL;
  size: string;
  width: number;
  height: number;
  quality: "xhigh";
  outputFormat: "png";
};

export type AiSceneV3ProviderPreflight = {
  request: AiSceneV3ImageRequest;
  capabilitySnapshot: ProviderCapabilitySnapshot;
};

/**
 * Reads the public model capability catalogue. The raw response is normalized
 * into the metadata persisted with each eventual candidate, so v3 never relies
 * on a hard-coded provider capability claim.
 */
export async function fetchAiSceneV3ProviderCapabilities(
  env: EnvLike = process.env,
  dependencies: { fetch?: FetchLike; now?: () => Date } = {},
): Promise<ProviderCapabilitySnapshot> {
  const endpoint = env.AI_SCENE_V3_CAPABILITIES_URL?.trim() || AITUNNEL_IMAGE_CAPABILITIES_URL;
  // Capability preflight must use the same forced-IPv4 transport as later
  // paid image calls. Otherwise a Windows Node IPv6/TLS stall can leave the
  // run hanging before a manifest or cost reservation exists.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), capabilitiesTimeoutMs(env));
  let response: FetchResponse;
  let body: string;
  try {
    response = await (dependencies.fetch || createAitunnelFetch(env))(endpoint, { headers: { Accept: "application/json" }, signal: controller.signal });
    body = await response.text();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("ai_scene_v3_capabilities_fetch_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`ai_scene_v3_capabilities_fetch_failed:${response.status}`);

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("ai_scene_v3_capabilities_invalid_json");
  }

  return normalizeAiSceneV3ProviderCapabilities(payload, {
    endpoint,
    fetchedAt: (dependencies.now || (() => new Date()))().toISOString(),
  });
}

function capabilitiesTimeoutMs(env: EnvLike) {
  const configured = Number(env.AI_SCENE_V3_CAPABILITIES_TIMEOUT_MS || AI_SCENE_V3_CAPABILITIES_TIMEOUT_MS);
  return Number.isInteger(configured) && configured >= 1_000 && configured <= 30_000
    ? configured
    : AI_SCENE_V3_CAPABILITIES_TIMEOUT_MS;
}

/** Normalizes only explicit capabilities; absent fields fail closed in preflight. */
export function normalizeAiSceneV3ProviderCapabilities(
  payload: unknown,
  metadata: { endpoint?: string; fetchedAt?: string } = {},
): ProviderCapabilitySnapshot {
  const model = findModelRecord(payload, AI_SCENE_V3_IMAGE_MODEL);
  if (!model) throw new Error("ai_scene_v3_capabilities_model_missing");
  const capabilities = record(model.capabilities) || model;
  const modalities = record(capabilities.modalities) || record(model.modalities) || {};
  const featureNames = new Set([
    ...stringList(capabilities.features),
    ...stringList(capabilities.capabilities),
    ...stringList(model.features),
  ].map((value) => value.toLowerCase()));
  const snapshot = providerCapabilitySnapshotSchema.parse({
    provider: "aitunnel",
    model: AI_SCENE_V3_IMAGE_MODEL,
    endpoint: metadata.endpoint || AITUNNEL_IMAGE_CAPABILITIES_URL,
    fetchedAt: metadata.fetchedAt || new Date().toISOString(),
    supportsGeneration: explicitBoolean(capabilities, ["supportsGeneration", "imageGeneration", "image_generation", "generation", "generate", "supports_generation"])
      || featureNames.has("image_generation") || featureNames.has("generation") || featureNames.has("generate"),
    supportsImageInput: explicitBoolean(capabilities, ["supportsImageInput", "imageInput", "image_input", "inputReferences", "input_references"])
      || stringList(modalities.input).map((value) => value.toLowerCase()).includes("image")
      || featureNames.has("image_input") || featureNames.has("input_references"),
    supportsEditing: explicitBoolean(capabilities, ["supportsEditing", "imageEditing", "image_editing", "editing", "edit", "supports_edit"])
      || featureNames.has("image_editing") || featureNames.has("editing") || featureNames.has("edit"),
    supportsCombinedResolutionAndAspectRatio: explicitBoolean(capabilities, ["supportsCombinedResolutionAndAspectRatio", "supports_combined_resolution_and_aspect_ratio"]),
    maxInputReferences: numberValue(firstDefined(capabilities, ["maxInputReferences", "max_input_references"])),
    qualities: stringList(firstDefined(capabilities, ["qualities", "quality", "supportedQualities", "supported_qualities", "supportedQuality", "supported_quality"])).map((value) => value.toLowerCase()),
    outputFormats: stringList(firstDefined(capabilities, ["outputFormats", "output_formats", "formats", "supportedFormats", "supported_formats", "supportedOutputFormats", "supported_output_formats"])).map((value) => value.toLowerCase()),
    sizes: stringList(firstDefined(capabilities, ["sizes", "imageSizes", "image_sizes", "supportedSizes", "supported_sizes", "supportedResolutions", "supported_resolutions"])).map((value) => value.toLowerCase()).filter((value) => /^\d{3,5}x\d{3,5}$/.test(value)),
    aspectRatios: stringList(firstDefined(capabilities, ["aspectRatios", "aspect_ratios", "supportedAspectRatios", "supported_aspect_ratios"])).map((value) => value.toLowerCase()),
    rawModelId: modelId(model) || AI_SCENE_V3_IMAGE_MODEL,
  });
  return snapshot;
}

/**
 * Uses a v3-only environment overlay. It deliberately leaves legacy image
 * defaults alone, so template/v2 images can retain their existing policy.
 */
export function aiSceneV3ImageEnv(env: EnvLike = process.env): EnvLike {
  return aiSceneImageEnv({
    ...env,
    AITUNNEL_IMAGE_MODEL: AI_SCENE_V3_IMAGE_MODEL,
    AITUNNEL_IMAGE_MODE: "raster",
    AITUNNEL_IMAGE_QUALITY: "xhigh",
    AITUNNEL_IMAGE_OUTPUT_FORMAT: "png",
    AITUNNEL_IMAGE_SIZE: env.AI_SCENE_V3_IMAGE_SIZE?.trim() || "",
  });
}

export function inspectAiSceneV3ProviderPreflight(
  env: EnvLike,
  capabilitySnapshot: ProviderCapabilitySnapshot,
): { request?: AiSceneV3ImageRequest; diagnostics: string[] } {
  const config = aitunnelImageConfig(aiSceneV3ImageEnv(env));
  const request = requestFromConfig(config);
  const diagnostics: string[] = [];

  if (!config || !env.AITUNNEL_API_KEY?.trim()) diagnostics.push("ai_scene_v3_provider_configuration_required");
  if (!config || config.mode !== "raster" || config.imageModel !== AI_SCENE_V3_IMAGE_MODEL) diagnostics.push("ai_scene_v3_flare_model_required");
  if (!config || config.quality !== "xhigh") diagnostics.push("ai_scene_v3_quality_mode_required");
  if (!config || config.outputFormat !== "png") diagnostics.push("ai_scene_v3_png_required");
  if (!request) diagnostics.push("ai_scene_v3_true_16_9_required");
  if (capabilitySnapshot.model !== AI_SCENE_V3_IMAGE_MODEL) diagnostics.push("ai_scene_v3_capability_model_mismatch");
  if (!capabilitySnapshot.supportsGeneration) diagnostics.push("ai_scene_v3_generation_unavailable");
  if (!capabilitySnapshot.supportsImageInput || capabilitySnapshot.maxInputReferences < AI_SCENE_V3_MAX_REFERENCE_IMAGES) diagnostics.push("ai_scene_v3_reference_input_unavailable");
  if (!capabilitySnapshot.supportsEditing) diagnostics.push("ai_scene_v3_edit_unavailable");
  if (!capabilitySnapshot.qualities.includes("xhigh")) diagnostics.push("ai_scene_v3_quality_mode_required");
  if (!capabilitySnapshot.outputFormats.includes("png")) diagnostics.push("ai_scene_v3_png_required");
  if (request && capabilitySnapshot.sizes.length > 0 && !capabilitySnapshot.sizes.includes(request.size)) diagnostics.push("ai_scene_v3_true_16_9_required");
  if (request && capabilitySnapshot.sizes.length === 0 && !capabilitySnapshot.supportsCombinedResolutionAndAspectRatio && !capabilitySnapshot.aspectRatios.includes("16:9")) diagnostics.push("ai_scene_v3_true_16_9_required");

  return { request, diagnostics: [...new Set(diagnostics)] };
}

export function assertAiSceneV3ProviderPreflight(
  env: EnvLike,
  capabilitySnapshot: ProviderCapabilitySnapshot,
): AiSceneV3ProviderPreflight {
  const result = inspectAiSceneV3ProviderPreflight(env, capabilitySnapshot);
  if (!result.request || result.diagnostics.length) throw new Error(result.diagnostics.join(","));
  return { request: result.request, capabilitySnapshot };
}

/** Validates the unmodified provider PNG before storage; it never crops or resizes. */
export async function verifyAiSceneV3GeneratedPng(input: {
  buffer: Buffer;
  contentType: string;
  request: AiSceneV3ImageRequest;
}): Promise<{ width: number; height: number }> {
  if (input.contentType.toLowerCase().split(";", 1)[0] !== "image/png") throw new Error("ai_scene_v3_png_required");
  const metadata = await sharp(input.buffer, { animated: false }).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (metadata.format !== "png") throw new Error("ai_scene_v3_png_required");
  if (!width || !height || !isTrueSixteenByNine(width, height)) throw new Error("ai_scene_v3_returned_true_16_9_required");
  if (width !== input.request.width || height !== input.request.height) throw new Error("ai_scene_v3_returned_dimensions_mismatch");
  return { width, height };
}

function requestFromConfig(config: AitunnelImageConfig | undefined): AiSceneV3ImageRequest | undefined {
  if (!config || config.imageModel !== AI_SCENE_V3_IMAGE_MODEL || config.quality !== "xhigh" || config.outputFormat !== "png") return undefined;
  const dimensions = parseDimensions(config.size);
  return dimensions && isTrueSixteenByNine(dimensions.width, dimensions.height)
    ? { model: AI_SCENE_V3_IMAGE_MODEL, size: config.size, ...dimensions, quality: "xhigh", outputFormat: "png" }
    : undefined;
}

function parseDimensions(value: string) {
  const match = /^(\d{3,5})x(\d{3,5})$/i.exec(value.trim());
  return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined;
}

function isTrueSixteenByNine(width: number, height: number) {
  return width * 9 === height * 16;
}

function findModelRecord(value: unknown, expectedModel: string, depth = 0): Record<string, unknown> | undefined {
  if (depth > 5) return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findModelRecord(entry, expectedModel, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const item = record(value);
  if (!item) return undefined;
  if (modelId(item)?.toLowerCase() === expectedModel) return item;
  for (const [key, entry] of Object.entries(item)) {
    if (key.toLowerCase() === expectedModel) {
      const directModel = record(entry);
      if (directModel) return { id: key, ...directModel };
    }
  }
  for (const key of ["data", "models", "items", "results"]) {
    const found = findModelRecord(item[key], expectedModel, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function modelId(value: Record<string, unknown>) {
  for (const key of ["id", "model", "model_id", "modelId"]) {
    const candidate = typeof value[key] === "string" ? value[key].trim() : "";
    if (candidate) return candidate;
  }
  return "";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstDefined(value: Record<string, unknown>, keys: string[]) {
  return keys.map((key) => value[key]).find((item) => item !== undefined);
}

function explicitBoolean(value: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => value[key] === true);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(stringList);
  if (typeof value === "string") return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}
