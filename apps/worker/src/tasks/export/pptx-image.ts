import sharp from "sharp";
import type { CanvasImageElement } from "@studydeck/shared";
import { errorLogFields, logger } from "../../observability.js";

type PptxImageSlide = { addImage: (...args: unknown[]) => void };

/** Owns binary image fitting before a renderer embeds an image in a PPTX. */
export async function addFittedPptxImage(slide: PptxImageSlide, data: string, box: { x: number; y: number; w: number; h: number }, options: { fit: CanvasImageElement["fit"]; rotate?: number; transparency?: number; altText?: string }) {
  const fitted = await fitPptxImage(data, box, options.fit);
  slide.addImage({ ...fitted, rotate: options.rotate, transparency: options.transparency, altText: options.altText || "" });
}

export async function fitPptxImage(data: string, box: { x: number; y: number; w: number; h: number }, fit: CanvasImageElement["fit"]) {
  try {
    const commaIndex = data.indexOf(",");
    if (commaIndex < 0) return { data, ...box };
    const source = Buffer.from(data.slice(commaIndex + 1), "base64");
    const metadata = await sharp(source).metadata();
    if (!metadata.width || !metadata.height) return { data, ...box };
    if (fit === "cover") {
      const fitted = await sharp(source).resize(Math.max(1, Math.round(box.w * 96)), Math.max(1, Math.round(box.h * 96)), { fit: "cover", position: "centre" }).png().toBuffer();
      return { data: `data:image/png;base64,${fitted.toString("base64")}`, ...box };
    }
    const scale = Math.min(box.w / metadata.width, box.h / metadata.height);
    const width = metadata.width * scale;
    const height = metadata.height * scale;
    return { data, x: box.x + (box.w - width) / 2, y: box.y + (box.h - height) / 2, w: width, h: height };
  } catch (error) {
    logger.warn({ ...errorLogFields(error) }, "could not fit PPTX image; using the original image box");
    return { data, ...box };
  }
}
