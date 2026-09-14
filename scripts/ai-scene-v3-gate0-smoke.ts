import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { runAiSceneV3Gate0Smoke } from "../apps/worker/src/tasks/presentation/ai-scene-v3/gate-0-smoke.js";

void (async () => {
  const imagePath = process.env.AI_SCENE_V3_GATE0_IMAGE_PATH || "plans/ai-scene-v3-gate-0-latest-image.png";
  const manifest = await runAiSceneV3Gate0Smoke({
    env: { ...process.env, AI_SCENE_V3_IMAGE_SIZE: "1536x864" },
    ceilingRub: "42.50",
    referenceUrls: [process.env.AI_SCENE_V3_GATE0_REFERENCE_URL || ""],
    onVerifiedImage: async (image) => {
      await writeFile(imagePath, image.buffer);
    },
  });

  const serialized = JSON.stringify(manifest, null, 2);
  await writeFile(process.env.AI_SCENE_V3_GATE0_MANIFEST_PATH || "plans/ai-scene-v3-gate-0-latest-run.json", serialized, "utf8");
  console.log(serialized);
  if (manifest.status !== "passed") process.exitCode = 1;
})();
