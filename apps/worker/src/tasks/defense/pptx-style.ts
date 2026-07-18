import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import sharp from "sharp";

const MAX_PPTX_BYTES = 50 * 1024 * 1024;
const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_BYTES = 8 * 1024 * 1024;

export type DefensePptxLogoCandidate = {
  path: string;
  buffer: Buffer;
  contentType: string;
  width?: number;
  height?: number;
};

export type DefensePptxStyleExtraction = {
  palette: string[];
  headingFont?: string;
  bodyFont?: string;
  mood: "light" | "dark" | "mixed";
  logoCandidates: DefensePptxLogoCandidate[];
  warnings: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: false,
  processEntities: false,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

export async function extractDefensePptxStyle(buffer: Buffer): Promise<DefensePptxStyleExtraction> {
  if (buffer.length > MAX_PPTX_BYTES) throw new Error("PPTX style reference exceeds the size limit");
  const zip = await JSZip.loadAsync(buffer, { createFolders: false, checkCRC32: false });
  const themeNames = Object.keys(zip.files).filter((name) => /^ppt\/theme\/theme\d+\.xml$/i.test(name));
  const masterNames = Object.keys(zip.files).filter((name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(name));
  const selectedXml = [...themeNames.slice(0, 4), ...masterNames.slice(0, 4), "ppt/presentation.xml"]
    .filter((name, index, values) => zip.files[name] && values.indexOf(name) === index);

  const colors: string[] = [];
  const fonts: string[] = [];
  const warnings: string[] = [];
  for (const name of selectedXml) {
    const xml = await readSafeXml(zip, name);
    collectThemeTokens(parser.parse(xml), colors, fonts);
  }

  const palette = unique(colors.map(normalizeHexColor).filter(Boolean) as string[]).slice(0, 8);
  if (!palette.length) warnings.push("В PPTX не найдена палитра; будет использована тема StudyDeck");
  const normalizedFonts = unique(fonts.map(normalizeFont).filter(Boolean) as string[]);
  if (!normalizedFonts.length) warnings.push("В PPTX не найдены шрифты; будут использованы шрифты темы StudyDeck");
  const logoCandidates = await extractMasterAndOpeningImages(zip, warnings);

  return {
    palette,
    headingFont: normalizedFonts[0],
    bodyFont: normalizedFonts[1] || normalizedFonts[0],
    mood: inferMood(palette),
    logoCandidates,
    warnings,
  };
}

async function extractMasterAndOpeningImages(zip: JSZip, warnings: string[]) {
  const relationshipNames = Object.keys(zip.files).filter((name) =>
    /^ppt\/(?:slideMasters\/_rels\/slideMaster\d+\.xml\.rels|slides\/_rels\/slide[12]\.xml\.rels)$/i.test(name),
  );
  const mediaNames = new Set<string>();
  for (const relationshipName of relationshipNames) {
    const xml = await readSafeXml(zip, relationshipName);
    const relationships = findRelationshipNodes(parser.parse(xml));
    const ownerDirectory = path.posix.dirname(path.posix.dirname(relationshipName));
    for (const relationship of relationships) {
      const target = String(relationship["@_Target"] || "");
      const type = String(relationship["@_Type"] || "");
      if (!target || !/\/image$/i.test(type)) continue;
      const resolved = path.posix.normalize(path.posix.join(ownerDirectory, target));
      if (/^ppt\/media\/[\w.-]+$/i.test(resolved) && zip.files[resolved] && !zip.files[resolved].dir) mediaNames.add(resolved);
    }
  }

  const candidates: DefensePptxLogoCandidate[] = [];
  for (const name of [...mediaNames].slice(0, 8)) {
    try {
      const buffer = await zip.files[name].async("nodebuffer");
      if (buffer.length > MAX_LOGO_BYTES) continue;
      const metadata = await sharp(buffer, { limitInputPixels: 48_000_000, failOn: "error" }).metadata();
      const contentType = imageContentType(metadata.format);
      if (!contentType) continue;
      candidates.push({ path: name, buffer, contentType, width: metadata.width, height: metadata.height });
    } catch {
      warnings.push(`Не удалось безопасно прочитать изображение ${path.posix.basename(name)} из PPTX`);
    }
  }
  return candidates;
}

async function readSafeXml(zip: JSZip, name: string) {
  const entry = zip.files[name];
  if (!entry || entry.dir) throw new Error(`PPTX XML part is missing: ${name}`);
  const declaredSize = Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0);
  if (declaredSize > MAX_XML_BYTES) throw new Error(`PPTX XML part is too large: ${name}`);
  const xml = await entry.async("string");
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) throw new Error(`PPTX XML part is too large: ${name}`);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(`PPTX XML declarations are not allowed: ${name}`);
  return xml;
}

function collectThemeTokens(value: unknown, colors: string[], fonts: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectThemeTokens(item, colors, fonts));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const attributes = child as Record<string, unknown>;
      if (/(?:^|:)(?:srgbClr|sysClr)$/i.test(key)) {
        colors.push(String(attributes["@_val"] || attributes["@_lastClr"] || ""));
      }
      if (/(?:^|:)(?:latin|ea|cs)$/i.test(key)) fonts.push(String(attributes["@_typeface"] || ""));
    }
    collectThemeTokens(child, colors, fonts);
  }
}

function findRelationshipNodes(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(findRelationshipNodes);
  const result: Array<Record<string, unknown>> = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:^|:)Relationship$/i.test(key)) {
      const values = Array.isArray(child) ? child : [child];
      result.push(...values.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")));
    } else {
      result.push(...findRelationshipNodes(child));
    }
  }
  return result;
}

function normalizeHexColor(value: string) {
  const normalized = String(value || "").replace(/^#/, "").trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? `#${normalized}` : "";
}

function normalizeFont(value: string) {
  const normalized = String(value || "").replace(/^\+m[jn]-/i, "").trim();
  return normalized && normalized.length <= 80 ? normalized : "";
}

function inferMood(palette: string[]): DefensePptxStyleExtraction["mood"] {
  if (!palette.length) return "mixed";
  const lightness = palette.map(relativeLuminance);
  const dark = lightness.filter((value) => value < 0.24).length;
  const light = lightness.filter((value) => value > 0.72).length;
  if (dark > light * 1.5) return "dark";
  if (light > dark * 1.5) return "light";
  return "mixed";
}

function relativeLuminance(hex: string) {
  const parts = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = parts.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function imageContentType(format?: string) {
  if (format === "png") return "image/png";
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "";
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}
