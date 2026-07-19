import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { extractTextFromSource } from "../extract.js";

export type ProvenanceChunk = {
  sourceId: string;
  locator: string;
  excerpt: string;
  text: string;
};

export type SourceExtractionResult = {
  chunks: ProvenanceChunk[];
  warning?: string;
  needsReview: boolean;
};

const parser = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false, trimValues: false });

export async function extractSourceWithProvenance(input: {
  sourceId: string;
  label: string;
  buffer: Buffer;
}): Promise<SourceExtractionResult> {
  const extension = path.extname(input.label).toLowerCase();
  if (extension === ".pptx") return extractPptxChunks(input.sourceId, input.buffer);

  const raw = cleanText(await extractTextFromSource(input.label, input.buffer));
  if (!raw) {
    return {
      chunks: [],
      needsReview: true,
      warning: extension === ".pdf"
        ? "В первой версии сканы не распознаются. Загрузите PDF с текстовым слоем или TXT/DOCX."
        : "В документе не найден текст для анализа.",
    };
  }
  return { chunks: chunkPlainText(input.sourceId, raw), needsReview: false };
}

export function chunkPlainText(sourceId: string, value: string, maxLength = 1400): ProvenanceChunk[] {
  const normalized = String(value || "").replace(/\r/g, "").trim();
  if (hasMarkdownStructure(normalized)) return chunkStructuredMarkdown(sourceId, normalized, maxLength);

  const paragraphs = normalized.split(/\n{2,}/).map(cleanText).filter(Boolean);
  const chunks: ProvenanceChunk[] = [];
  let current = "";
  let startParagraph = 1;
  const flush = (endParagraph: number) => {
    if (!current) return;
    chunks.push({
      sourceId,
      locator: startParagraph === endParagraph ? `абзац ${startParagraph}` : `абзацы ${startParagraph}–${endParagraph}`,
      excerpt: current.slice(0, 360),
      text: current,
    });
    current = "";
  };
  paragraphs.forEach((paragraph, index) => {
    const paragraphNumber = index + 1;
    if (!current) startParagraph = paragraphNumber;
    if (current && current.length + paragraph.length + 2 > maxLength) {
      flush(paragraphNumber - 1);
      startParagraph = paragraphNumber;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  });
  flush(paragraphs.length);
  return chunks;
}

function hasMarkdownStructure(value: string) {
  return /^(?:#{1,6}\s+|[-*+]\s+|```)/m.test(value);
}

function chunkStructuredMarkdown(sourceId: string, value: string, maxLength: number): ProvenanceChunk[] {
  const blocks: Array<{ heading: string; startLine: number; endLine: number; text: string }> = [];
  const lines = value.split("\n");
  let heading = "";
  let blockLines: string[] = [];
  let startLine = 1;
  let fenced = false;

  const flush = (endLine: number) => {
    const text = cleanText(blockLines.join("\n"));
    if (text) blocks.push({ heading, startLine, endLine, text });
    blockLines = [];
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch && !fenced) {
      flush(lineNumber - 1);
      heading = cleanText(headingMatch[1]);
      startLine = lineNumber + 1;
      return;
    }
    if (/^```/.test(line.trim())) {
      if (blockLines.length) flush(lineNumber - 1);
      fenced = !fenced;
      blockLines = [line];
      startLine = lineNumber;
      if (!fenced) flush(lineNumber);
      startLine = lineNumber + 1;
      return;
    }
    if (!blockLines.length) startLine = lineNumber;
    if (!line.trim() && !fenced) {
      flush(lineNumber - 1);
      startLine = lineNumber + 1;
      return;
    }
    blockLines.push(line);
  });
  flush(lines.length);

  return blocks.flatMap((block) => splitStructuredBlock(sourceId, block, maxLength));
}

function splitStructuredBlock(
  sourceId: string,
  block: { heading: string; startLine: number; endLine: number; text: string },
  maxLength: number,
): ProvenanceChunk[] {
  const locator = block.heading
    ? `раздел «${block.heading}», строки ${block.startLine}–${block.endLine}`
    : `строки ${block.startLine}–${block.endLine}`;
  const words = block.text.split(/\s+/).filter(Boolean);
  const chunks: ProvenanceChunk[] = [];
  let current: string[] = [];
  let length = 0;
  const flush = () => {
    const text = current.join(" ");
    if (text) chunks.push({ sourceId, locator, excerpt: text.slice(0, 360), text });
    current = [];
    length = 0;
  };

  for (const word of words) {
    if (current.length && length + word.length + 1 > maxLength) flush();
    current.push(word);
    length += word.length + (current.length > 1 ? 1 : 0);
  }
  flush();
  return chunks;
}

async function extractPptxChunks(sourceId: string, buffer: Buffer): Promise<SourceExtractionResult> {
  const zip = await JSZip.loadAsync(buffer, { createFolders: false, checkCRC32: false });
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const chunks: ProvenanceChunk[] = [];
  for (const name of slideNames.slice(0, 100)) {
    const xml = await zip.files[name].async("string");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("PPTX XML declarations are not allowed");
    const textValues: string[] = [];
    collectTextNodes(parser.parse(xml), textValues);
    const text = cleanText(textValues.join(" "));
    if (!text) continue;
    const order = slideNumber(name);
    chunks.push({ sourceId, locator: `слайд ${order}`, excerpt: text.slice(0, 360), text: text.slice(0, 6000) });
  }
  return {
    chunks,
    needsReview: chunks.length === 0,
    warning: chunks.length ? undefined : "В PPTX не найден доступный текст.",
  };
}

function collectTextNodes(value: unknown, result: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTextNodes(item, result));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:^|:)t$/i.test(key) && typeof child === "string") result.push(child);
    else collectTextNodes(child, result);
  }
}

function slideNumber(name: string) {
  return Number(name.match(/slide(\d+)/i)?.[1] || 0);
}

function cleanText(value: string) {
  return String(value || "").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}
