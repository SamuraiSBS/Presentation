import type { Job } from "bullmq";
import { createRequire } from "node:module";
import { presentationSchema } from "@studydeck/shared";
import { getPrisma } from "../prisma.js";
import { putObjectBuffer, readObjectBuffer } from "../storage.js";

const require = createRequire(import.meta.url);
const PptxGenConstructor = require("pptxgenjs") as new () => {
  layout: string;
  author: string;
  subject: string;
  title: string;
  lang: string;
  theme: Record<string, unknown>;
  ShapeType: { rect: string; roundRect: string };
  addSlide: () => any;
  write: (options: { outputType: "nodebuffer" }) => Promise<Buffer>;
};

export async function handleExportJob(job: Job<{ exportId: string; projectId: string; type: "pdf" | "pptx" }>) {
  const prisma = getPrisma();
  const { exportId, projectId, type } = job.data;
  await prisma.export.update({ where: { id: exportId }, data: { status: "processing" } });

  try {
    const presentationRow = await prisma.presentation.findUniqueOrThrow({ where: { projectId } });
    const presentation = presentationSchema.parse(presentationRow.document);
    const key = `projects/${projectId}/exports/${exportId}.${type}`;
    const buffer = type === "pptx" ? await createPptx(presentation) : createPdfPlaceholder(presentation);
    const contentType =
      type === "pptx"
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : "application/pdf";

    await putObjectBuffer(key, buffer, contentType);
    await prisma.export.update({ where: { id: exportId }, data: { status: "ready", objectKey: key } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    await prisma.export.update({ where: { id: exportId }, data: { status: "failed", error: message } });
    throw error;
  }
}

export async function createPptx(presentation: ReturnType<typeof presentationSchema.parse>) {
  const pptx = new PptxGenConstructor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "StudyDeck AI";
  pptx.subject = presentation.scenario;
  pptx.title = presentation.title;
  pptx.lang = "ru-RU";
  pptx.theme = {
    headFontFace: "Arial",
    bodyFontFace: "Arial",
    lang: "ru-RU",
  };

  for (const item of presentation.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: "FBFAF5" };
    const imageData = await readSlideImageData(item);

    if (imageData && (item.slideKind === "title" || item.slideKind === "section")) {
      slide.addImage({ data: imageData, x: 0, y: 0, w: 13.333, h: 7.5 });
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 13.333,
        h: 7.5,
        fill: { color: "FBFAF5", transparency: 18 },
        line: { transparency: 100 },
      });
      slide.addText(item.title, {
        x: 0.9,
        y: 2.15,
        w: 11.55,
        h: 1.25,
        fontFace: "Arial",
        fontSize: 36,
        bold: true,
        color: "17201B",
        align: "center",
        valign: "mid",
        fit: "shrink",
      });

      slide.addText(slideBodyText(item), {
        x: 1.65,
        y: 3.65,
        w: 10,
        h: 1.25,
        fontFace: "Arial",
        fontSize: 19,
        color: "27362F",
        align: "center",
        valign: "mid",
        fit: "shrink",
      });
    } else {
      const hasSideImage = Boolean(imageData);
      slide.addText(item.title, {
        x: 0.72,
        y: 0.68,
        w: hasSideImage ? 5.5 : 11.9,
        h: 1.05,
        fontFace: "Arial",
        fontSize: hasSideImage ? 28 : 34,
        bold: true,
        color: "17201B",
        align: hasSideImage ? "left" : "center",
        valign: "mid",
        fit: "shrink",
      });

      slide.addText(slideBodyText(item), {
        x: hasSideImage ? 0.82 : 1.5,
        y: hasSideImage ? 2.05 : 3.55,
        w: hasSideImage ? 5.35 : 10.33,
        h: hasSideImage ? 3.5 : 1.45,
        fontFace: "Arial",
        fontSize: hasSideImage ? 18 : 19,
        color: "27362F",
        align: hasSideImage ? "left" : "center",
        valign: "mid",
        breakLine: false,
        fit: "shrink",
      });

      if (imageData) {
        slide.addImage({ data: imageData, x: 6.72, y: 0.68, w: 5.9, h: 5.85 });
        const attribution = imageAttribution(item);
        if (attribution) {
          slide.addText(attribution, {
            x: 6.72,
            y: 6.62,
            w: 5.9,
            h: 0.24,
            fontFace: "Arial",
            fontSize: 7,
            color: "6F766F",
            align: "right",
            fit: "shrink",
          });
        }
      }
    }

    slide.addNotes([item.speakerNotes, "", "Рассказ:", presentation.speechScript.find((entry) => entry.slideOrder === item.order)?.text || ""].join("\n"));
  }

  return pptx.write({ outputType: "nodebuffer" }) as Promise<Buffer>;
}

function createPdfPlaceholder(presentation: ReturnType<typeof presentationSchema.parse>) {
  const text = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length 72>>stream
BT /F1 18 Tf 72 720 Td (${escapePdf(presentation.title)} - PDF export queued) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000204 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
326
%%EOF`;
  return Buffer.from(text, "utf8");
}

function slideBodyText(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const structured = [
    slide.thesis,
    ...slide.bullets,
    definitionText(slide),
    visualText(slide),
  ]
    .filter(Boolean)
    .join(" ");
  const text = structured || slide.blocks
    .flatMap((block) => (block.type === "bullets" ? block.items : "content" in block ? [block.content] : []))
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  return sentencePreview(text);
}

function definitionText(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  return slide.definition ? `${slide.definition.term}: ${slide.definition.text}` : "";
}

function visualText(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const visual = slide.visual;
  if (!visual || visual.type === "none") return "";
  const rows = visual.rows.map((row) => [row.label, row.left, row.right].filter(Boolean).join(": ")).filter(Boolean);
  const items = visual.items.map((item) => [item.label, item.text].filter(Boolean).join(": ")).filter(Boolean);
  const content = (rows.length ? rows : items).slice(0, 4).join("; ");
  return [visual.title || visual.type, content].filter(Boolean).join(": ");
}

async function readSlideImageData(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const image = slide.visual.image;
  if (!image?.objectKey) return null;

  try {
    const buffer = await readObjectBuffer(image.objectKey);
    const contentType = image.contentType || contentTypeFromObjectKey(image.objectKey);
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn(`Could not read slide image ${image.objectKey}:`, error);
    return null;
  }
}

function contentTypeFromObjectKey(objectKey: string) {
  const lower = objectKey.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function imageAttribution(slide: ReturnType<typeof presentationSchema.parse>["slides"][number]) {
  const image = slide.visual.image;
  if (!image) return "";
  return [image.sourceTitle, image.sourceUrl].filter(Boolean).join(" - ");
}

function escapePdf(value: string) {
  return value.replace(/[()\\]/g, "");
}

function sentencePreview(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3);
  const preview = sentences.length ? sentences.join(" ") : text;

  return preview.length > 320 ? `${preview.slice(0, 317).trim()}...` : preview;
}
