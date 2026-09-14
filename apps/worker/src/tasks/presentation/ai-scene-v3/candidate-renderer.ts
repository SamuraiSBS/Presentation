import {
  slideCanvasSchema,
  PRESENTATION_FONT_FAMILY,
  type EditableTextValue,
  type SlideCanvas,
  type TextLayoutV3,
} from "@studydeck/shared";
import { renderAiSceneCanvas } from "../ai-scene/scene-render.js";
import { aiSceneV3NativeBackplateBounds, aiSceneV3NativeBackplateColor } from "./native-backplate.js";

export type AiSceneV3RenderedCandidate = { canvas: SlideCanvas; preview: Buffer };

/** Builds the editable 1280x720 canvas from exact text values and a validated layout. */
export async function renderAiSceneV3Candidate(input: {
  background: { buffer: Buffer; objectKey: string; url: string; alt: string; contentType: "image/png" };
  layout: TextLayoutV3;
  textValues: readonly { semanticId: string; value: EditableTextValue }[];
  backgroundColor: string;
}): Promise<AiSceneV3RenderedCandidate> {
  const values = new Map(input.textValues.map((entry) => [entry.semanticId, entry.value.text]));
  const layoutIds = new Set(input.layout.entries.map((entry) => entry.semanticId));
  if (values.size !== input.textValues.length || values.size !== layoutIds.size || input.layout.entries.some((entry) => !values.has(entry.semanticId))) {
    throw new Error("ai_scene_v3_candidate_text_values_mismatch");
  }
  const canvas = slideCanvasSchema.parse({
    version: 3,
    origin: "ai_scene_v3",
    width: 1280,
    height: 720,
    background: input.backgroundColor,
    elements: [
      { id: "ai-scene-v3-background", type: "image", x: 0, y: 0, w: 1280, h: 720, rotation: 0, zIndex: 0, opacity: 1, locked: true, url: input.background.url, objectKey: input.background.objectKey, alt: input.background.alt, contentType: input.background.contentType, fit: "cover", sourceWidth: 1536, sourceHeight: 864 },
      ...input.layout.entries.flatMap((entry, index) => {
        const id = `ai-scene-v3-${entry.semanticId.replace(/:/g, "-")}`;
        const zIndex = index * 2 + 1;
        const backplate = aiSceneV3NativeBackplateBounds(entry);
        return [
          // A canvas shape is a deterministic, separately-addressable native
          // layer. It guarantees a contrast field without rasterizing or
          // locking the editable text that sits immediately above it.
          {
            id: `${id}-backplate`, type: "shape" as const, shape: "roundRect" as const,
            x: backplate.x, y: backplate.y, w: backplate.w, h: backplate.h, rotation: 0, zIndex, opacity: 1, locked: true,
            fill: aiSceneV3NativeBackplateColor(entry.color, input.backgroundColor), stroke: aiSceneV3NativeBackplateColor(entry.color, input.backgroundColor), strokeWidth: 0,
          },
          {
            id,
            type: "text" as const,
            x: entry.x, y: entry.y, w: entry.w, h: entry.h, rotation: 0, zIndex: zIndex + 1, opacity: 1, locked: !entry.editable,
            role: entry.semanticId === "title" ? "title" as const : "body" as const,
            typographyRole: entry.semanticId === "title" ? "slideTitle" as const : "supporting" as const,
            text: values.get(entry.semanticId)!, runs: [], fontSize: Math.round(entry.fontSize), autoFit: false,
            fontFamily: PRESENTATION_FONT_FAMILY, color: entry.color, bold: entry.fontWeight >= 600, italic: false, underline: false,
            align: entry.align, valign: entry.verticalAlign,
          },
        ];
      }),
    ],
  });
  return { canvas, preview: await renderAiSceneCanvas(canvas, input.background.buffer) };
}
