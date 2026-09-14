import sharp from "sharp";

/**
 * Gate 1 sends real local references to the image provider, but a full-size
 * lossless PNG data URL can turn three visual references into several
 * megabytes of request payload. Keep the image content while bounding the
 * transport representation before a paid request is made.
 */
export const AI_SCENE_V3_REFERENCE_TRANSPORT = {
  maxWidth: 960,
  maxHeight: 540,
  maxBytes: 450_000,
  jpegQuality: 82,
} as const;

export type AiSceneV3PreparedReference = {
  dataUrl: string;
  contentType: "image/jpeg";
  width: number;
  height: number;
  bytes: number;
};

export async function prepareAiSceneV3ReferenceDataUrl(source: Buffer): Promise<AiSceneV3PreparedReference> {
  const body = await sharp(source, { animated: false })
    .rotate()
    .resize(AI_SCENE_V3_REFERENCE_TRANSPORT.maxWidth, AI_SCENE_V3_REFERENCE_TRANSPORT.maxHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: AI_SCENE_V3_REFERENCE_TRANSPORT.jpegQuality, chromaSubsampling: "4:2:0", mozjpeg: true })
    .toBuffer();
  const metadata = await sharp(body, { animated: false }).metadata();
  if (!metadata.width || !metadata.height || metadata.width > AI_SCENE_V3_REFERENCE_TRANSPORT.maxWidth || metadata.height > AI_SCENE_V3_REFERENCE_TRANSPORT.maxHeight) {
    throw new Error("ai_scene_v3_reference_transport_dimensions_invalid");
  }
  if (body.byteLength > AI_SCENE_V3_REFERENCE_TRANSPORT.maxBytes) {
    throw new Error("ai_scene_v3_reference_transport_too_large");
  }
  return {
    dataUrl: `data:image/jpeg;base64,${body.toString("base64")}`,
    contentType: "image/jpeg",
    width: metadata.width,
    height: metadata.height,
    bytes: body.byteLength,
  };
}
