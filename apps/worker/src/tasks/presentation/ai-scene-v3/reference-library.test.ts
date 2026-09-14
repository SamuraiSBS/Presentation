import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { importAiSceneV3ReferenceLibrary, selectAiSceneV3References } from "./reference-library.js";

const tempDirectories: string[] = [];
afterEach(async () => Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("AI Scene v3 reference library", () => {
  it("imports a crop-free, versioned PNG without persisting a local source path", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-scene-v3-ref-")); tempDirectories.push(directory);
    const source = path.join(directory, "reference.jpg");
    await writeFile(source, await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#112233" } }).jpeg().toBuffer());
    const uploaded: Array<{ key: string; body: Buffer }> = [];
    const manifest = await importAiSceneV3ReferenceLibrary({
      sources: [{ id: "solar-01", profileId: "solar_scientific_dark", filePath: source }],
      putObject: async (key, body) => { uploaded.push({ key, body }); },
    });
    expect(manifest.assets[0]).toMatchObject({ profileId: "solar_scientific_dark", contentType: "image/png", width: 1600, height: 800 });
    expect(manifest.assets[0]?.objectKey).not.toContain(directory);
    expect(uploaded[0]?.key).toContain("ai-scene-v3/reference-library/v1/solar_scientific_dark");
    expect(selectAiSceneV3References(manifest, ["solar_scientific_dark"])).toHaveLength(1);
  });
});
