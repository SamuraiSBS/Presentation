import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import mammoth from "mammoth";

const xmlParser = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false, trimValues: false });

export async function extractTextFromSource(label: string, buffer: Buffer) {
  const extension = path.extname(label).toLowerCase();

  if (extension === ".txt" || extension === ".md" || extension === ".csv") {
    return buffer.toString("utf8");
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }

  if (extension === ".pptx") {
    return extractPptxText(buffer);
  }

  if (extension === ".pdf") {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = (pdfParseModule as unknown as { default?: (input: Buffer) => Promise<{ text?: string }> }).default;
    if (!pdfParse) throw new Error("pdf-parse default export is unavailable");
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  }

  return buffer.toString("utf8");
}

async function extractPptxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
  const chunks: string[] = [];

  for (const name of slideFiles) {
    const xml = await zip.files[name].async("string");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("PPTX XML declarations are not allowed");
    const values: string[] = [];
    collectPptxText(xmlParser.parse(xml), values);
    chunks.push(values.join(" "));
  }

  return chunks.join("\n\n");
}

function collectPptxText(value: unknown, result: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPptxText(item, result));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:^|:)t$/i.test(key) && typeof child === "string") result.push(child);
    else collectPptxText(child, result);
  }
}
