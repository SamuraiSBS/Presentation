import type { TextLayoutV3 } from "@studydeck/shared";

type OverlayRectangle = Pick<TextLayoutV3["entries"][number], "semanticId" | "x" | "y" | "w" | "h">;

/**
 * TextLayout describes the inner editable text box. The native contrast plate
 * extends to the quiet field around it, so its outer bounds are subject to
 * the same collision and protected-art checks as the text itself.
 */
export function aiSceneV3NativeBackplateBounds(entry: OverlayRectangle) {
  if (entry.semanticId === "title") {
    return { x: entry.x - 18, y: entry.y + 3, w: entry.w + 32, h: entry.h - 4 };
  }
  return { x: entry.x - 18, y: entry.y - 16, w: entry.w + 48, h: entry.h + 28 };
}

/**
 * The contrast field is a native opaque shape, not an estimate of the image
 * provider's pixels. Keep the renderer and the Gate 1 quality check on the
 * exact same deterministic color decision.
 */
export function aiSceneV3NativeBackplateColor(textColor: string, canvasBackground: string) {
  const textLuminance = relativeLuminance(textColor);
  const backgroundLuminance = relativeLuminance(canvasBackground);
  if (contrastRatio(textLuminance, backgroundLuminance) >= 4.5) return canvasBackground;
  return contrastRatio(textLuminance, 0) >= contrastRatio(textLuminance, 1) ? "#000000" : "#FFFFFF";
}

/** A WCAG-AA contrast ratio calculated from the actual opaque native plate. */
export function aiSceneV3NativeBackplateContrastRatio(textColor: string, canvasBackground: string) {
  return contrastRatio(relativeLuminance(textColor), relativeLuminance(aiSceneV3NativeBackplateColor(textColor, canvasBackground)));
}

function relativeLuminance(color: string) {
  const hex = color.replace("#", "");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return red * .2126 + green * .7152 + blue * .0722;
}

function contrastRatio(left: number, right: number) {
  return (Math.max(left, right) + .05) / (Math.min(left, right) + .05);
}
