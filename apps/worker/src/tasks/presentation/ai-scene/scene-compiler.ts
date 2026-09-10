import {
  aiSceneSpecSchema,
  slideCanvasSchema,
  type AiSceneSpec,
  type CanvasElement,
  type SlideCanvas,
  type SlideContentLock,
} from "@studydeck/shared";
import { contentLockText } from "./content-lock.js";
import { inspectAiScenePreflight } from "./scene-preflight.js";

export type SceneAssets = { background: { objectKey: string; url: string; contentType: string; alt: string } };

/** Materializes the AI-owned geometry without selecting a legacy layout. */
export function compileAiScene(input: { scene: AiSceneSpec; contentLock: SlideContentLock; assets: SceneAssets }): SlideCanvas {
  const scene = aiSceneSpecSchema.parse(input.scene);
  if (scene.slideId !== input.contentLock.slideId) throw new Error("ai_scene_slide_lock_mismatch");
  const preflightDiagnostics = inspectAiScenePreflight(scene, input.contentLock);
  if (preflightDiagnostics.length) throw new Error(`ai_scene_preflight_failed:${preflightDiagnostics.join("; ")}`);
  const elements: CanvasElement[] = [
    {
      id: "ai-scene-background", type: "image", x: 0, y: 0, w: 1280, h: 720, rotation: 0, zIndex: 0, opacity: 1, locked: false,
      url: input.assets.background.url, objectKey: input.assets.background.objectKey, contentType: input.assets.background.contentType,
      alt: input.assets.background.alt, fit: "cover",
    },
  ];
  for (const element of scene.elements) {
    if (element.type === "text") {
      const text = contentLockText(input.contentLock, element.textRef);
      if (!text) throw new Error(`ai_scene_unknown_text_ref:${element.textRef}`);
      elements.push({ id: element.id, type: "text", x: element.x, y: element.y, w: element.w, h: element.h, rotation: 0, zIndex: element.zIndex, opacity: 1, locked: false, role: element.role === "title" ? "title" : element.role === "thesis" ? "body" : "caption", typographyRole: element.role === "title" ? "slideTitle" : element.role === "thesis" ? "body" : "label", text, runs: [], fontSize: element.fontSize, fontFamily: "Arial", color: element.color, bold: element.bold, italic: false, underline: false, align: element.align, valign: "top" });
    } else if (element.type === "shape") {
      elements.push({ id: element.id, type: "shape", x: element.x, y: element.y, w: element.w, h: element.h, rotation: 0, zIndex: element.zIndex, opacity: element.opacity, locked: false, shape: element.shape, fill: element.fill, stroke: element.stroke, strokeWidth: element.shape === "line" ? 3 : 0 });
    } else {
      const nodes = element.nodeRefs.map((textRef, index) => {
        const label = contentLockText(input.contentLock, textRef);
        if (!label) throw new Error(`ai_scene_unknown_diagram_ref:${textRef}`);
        return { id: `node-${index + 1}`, label };
      });
      elements.push({ id: element.id, type: "diagram", x: element.x, y: element.y, w: element.w, h: element.h, rotation: 0, zIndex: element.zIndex, opacity: 1, locked: false, caption: "", model: { kind: "scheme", template: element.template, nodes, edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })) } });
    }
  }
  return slideCanvasSchema.parse({ version: 2, origin: "ai_scene_v2", width: 1280, height: 720, background: scene.background.color, elements });
}
