import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export type AiSceneV3ReferenceProfile = {
  id: "solar_scientific_dark" | "porsche_cinematic_dark" | "don_nature_light";
  tone: "dark" | "light";
  palette: string[];
  visualDensity: "restrained" | "layered" | "cinematic";
  imageCharacter: string;
  compositionPatterns: string[];
  textHierarchy: string;
  successfulTechniques: string[];
  forbiddenTransfers: string[];
};

export type AiSceneV3ReferenceAsset = {
  id: string;
  profileId: AiSceneV3ReferenceProfile["id"];
  objectKey: string;
  sourceHash: string;
  optimizedHash: string;
  width: number;
  height: number;
  contentType: "image/png";
};

export type AiSceneV3ReferenceLibraryManifest = {
  version: 1;
  profiles: AiSceneV3ReferenceProfile[];
  assets: AiSceneV3ReferenceAsset[];
};

export const AI_SCENE_V3_REFERENCE_PROFILES: AiSceneV3ReferenceProfile[] = [
  {
    id: "solar_scientific_dark", tone: "dark", palette: ["#071827", "#16385C", "#55D6E8", "#FFC857"], visualDensity: "layered",
    imageCharacter: "Deep-space scientific explanation with distinct celestial objects and readable spatial relations.",
    compositionPatterns: ["layered orbital relationship", "single luminous focal object with satellites", "calm side text zone"],
    textHierarchy: "One high-contrast title, then short native labels only in deliberate quiet zones.",
    successfulTechniques: ["depth through scale", "glowing directional lines", "clear object separation"],
    forbiddenTransfers: ["microtext", "copied labels", "dense interface cards"],
  },
  {
    id: "porsche_cinematic_dark", tone: "dark", palette: ["#080A0E", "#282D36", "#F0F2F5", "#D61F32"], visualDensity: "cinematic",
    imageCharacter: "Dark photographic automotive storytelling with one confident hero and purposeful movement.",
    compositionPatterns: ["hero vehicle with negative space", "chronology through motion", "asymmetric comparison"],
    textHierarchy: "Large restrained title, compact native supporting text away from the vehicle silhouette.",
    successfulTechniques: ["directional light", "controlled reflections", "strong crop-free subject framing"],
    forbiddenTransfers: ["brand marks", "Porsche wordmarks", "dashboard UI cards"],
  },
  {
    id: "don_nature_light", tone: "light", palette: ["#F4F0DF", "#315C3A", "#9AB86A", "#526E9A"], visualDensity: "restrained",
    imageCharacter: "Light natural photography with tactile flora, seasonality, and a geographic sense of place.",
    compositionPatterns: ["foreground plant with landscape depth", "seasonal process", "map-like environmental relation"],
    textHierarchy: "Dark native text on quiet light areas, never over detailed foliage.",
    successfulTechniques: ["natural depth", "soft daylight", "visible material detail"],
    forbiddenTransfers: ["watermarks", "photographic captions", "generic eco-card grids"],
  },
];

/**
 * Imports source references into a versioned asset pack. Source paths are used
 * only at import time and do not leak into the persisted manifest, keeping the
 * production pipeline independent from a developer's D: drive.
 */
export async function importAiSceneV3ReferenceLibrary(input: {
  sources: readonly { id: string; profileId: AiSceneV3ReferenceProfile["id"]; filePath: string }[];
  putObject: (objectKey: string, body: Buffer, contentType: "image/png") => Promise<void>;
}): Promise<AiSceneV3ReferenceLibraryManifest> {
  const profiles = new Map(AI_SCENE_V3_REFERENCE_PROFILES.map((profile) => [profile.id, profile]));
  if (!input.sources.length) throw new Error("ai_scene_v3_reference_library_empty");
  const seen = new Set<string>();
  const assets: AiSceneV3ReferenceAsset[] = [];

  for (const source of input.sources) {
    if (!profiles.has(source.profileId) || seen.has(source.id)) throw new Error("ai_scene_v3_reference_library_source_invalid");
    seen.add(source.id);
    const sourceBuffer = await readFile(source.filePath);
    const sourceHash = sha256(sourceBuffer);
    const optimized = await sharp(sourceBuffer, { animated: false })
      .rotate()
      .resize({ width: 1600, height: 900, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    const metadata = await sharp(optimized).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`ai_scene_v3_reference_library_dimensions_missing:${source.id}`);
    const optimizedHash = sha256(optimized);
    const extensionlessId = source.id.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    if (!extensionlessId) throw new Error("ai_scene_v3_reference_library_source_invalid");
    const objectKey = path.posix.join("ai-scene-v3", "reference-library", "v1", source.profileId, `${extensionlessId}-${optimizedHash.slice(0, 16)}.png`);
    await input.putObject(objectKey, optimized, "image/png");
    assets.push({ id: source.id, profileId: source.profileId, objectKey, sourceHash, optimizedHash, width: metadata.width, height: metadata.height, contentType: "image/png" });
  }

  return { version: 1, profiles: [...profiles.values()], assets };
}

export function selectAiSceneV3References(manifest: AiSceneV3ReferenceLibraryManifest, profileIds: readonly string[], max = 3) {
  const allowed = new Set(profileIds);
  const selected = manifest.assets.filter((asset) => allowed.has(asset.profileId)).slice(0, max);
  if (!selected.length || selected.length > 3) throw new Error("ai_scene_v3_reference_selection_invalid");
  return selected;
}

function sha256(value: Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
