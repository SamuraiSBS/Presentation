import path from "node:path";
import { readFile } from "node:fs/promises";
import { loadAiSceneV3Gate1Input, prepareAiSceneV3Gate1Input, type AiSceneV3Gate1Topic } from "../apps/worker/src/tasks/presentation/ai-scene-v3/gate-1-inputs.js";
import { AI_SCENE_V3_REFERENCE_TRANSPORT, prepareAiSceneV3ReferenceDataUrl } from "../apps/worker/src/tasks/presentation/ai-scene-v3/reference-data.js";

const referenceRoot = path.resolve("референц слайдов");
const topics: AiSceneV3Gate1Topic[] = [
  {
    id: "solar_system", profileId: "solar_scientific_dark", contentSlideOrder: 2,
    docxPath: path.join(referenceRoot, "Солнечная_система_текст_выступления_2.docx"),
    referencePaths: [path.join(referenceRoot, "1.png"), path.join(referenceRoot, "2.png"), path.join(referenceRoot, "3.png")],
  },
  {
    id: "porsche_911", profileId: "porsche_cinematic_dark", contentSlideOrder: 2,
    docxPath: path.join(referenceRoot, "Porsche", "Porsche 911- история и наследие.docx"),
    referencePaths: [path.join(referenceRoot, "Porsche", "1.png"), path.join(referenceRoot, "Porsche", "2.png"), path.join(referenceRoot, "Porsche", "3.png")],
  },
  {
    id: "don_nature", profileId: "don_nature_light", contentSlideOrder: 2,
    docxPath: path.join(referenceRoot, "Природа и растения Ростовской области", "Природа и растения Ростовской области.docx"),
    referencePaths: [path.join(referenceRoot, "Природа и растения Ростовской области", "ChatGPT Image 10 сент. 2026 г., 21_52_13 (1).png"), path.join(referenceRoot, "Природа и растения Ростовской области", "ChatGPT Image 10 сент. 2026 г., 21_52_14 (2).png"), path.join(referenceRoot, "Природа и растения Ростовской области", "ChatGPT Image 10 сент. 2026 г., 21_52_14 (3).png")],
  },
];

void (async () => {
  const inputs = await Promise.all(topics.map(loadAiSceneV3Gate1Input));
  const preparations = inputs.map((input) => {
    try {
      return prepareAiSceneV3Gate1Input(input);
    } catch (error) {
      throw new Error(`ai_scene_v3_gate_1_preflight_preparation_failed:${input.id}:${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const referenceTransport = await Promise.all(inputs.map(async (input) => {
    const references = await Promise.all(input.referencePaths.map(async (referencePath) => prepareAiSceneV3ReferenceDataUrl(await readFile(referencePath))));
    return {
      id: input.id,
      count: references.length,
      encodedBytes: references.reduce((total, reference) => total + Buffer.byteLength(reference.dataUrl), 0),
      assets: references.map((reference) => ({ width: reference.width, height: reference.height, bytes: reference.bytes })),
    };
  }));
  // Paths and speech stay local for the preflight. The later manifest records
  // only imported asset IDs/object keys and speech hashes.
  console.log(JSON.stringify({
    gate: "gate_1_input_preflight",
    status: "ready_for_reference_import",
    referenceTransport: { ...AI_SCENE_V3_REFERENCE_TRANSPORT, topics: referenceTransport },
    topics: inputs.map((input, index) => ({ id: input.id, profileId: input.profileId, slideOrder: input.slide.order, title: input.slide.title, speechSectionHash: input.speechSectionHash, referenceCount: input.referencePaths.length, speechCharacters: input.slide.speakerNotes.length, anchors: preparations[index]!.brief.anchors.map((anchor) => ({ id: anchor.id, characters: anchor.text.length, sourceTraceCharacters: anchor.sourceTrace.length })), textZones: preparations[index]!.plans.map((plan) => ({ variant: plan.variant, zones: plan.textZones.map((zone) => ({ semanticId: zone.semanticId, zone: zone.zone })) })) })),
  }, null, 2));
})().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
