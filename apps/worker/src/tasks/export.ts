import type { Job } from "bullmq";
import { createRequire } from "node:module";
import { presentationSchema } from "@studydeck/shared";
import { getPrisma } from "../prisma.js";
import { putObjectBuffer } from "../storage.js";

const require = createRequire(import.meta.url);
const PptxGenConstructor = require("pptxgenjs") as new () => {
  layout: string;
  author: string;
  subject: string;
  title: string;
  lang: string;
  theme: Record<string, unknown>;
  ShapeType: { roundRect: string };
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
    slide.addText(item.title, {
      x: 0.55,
      y: 0.35,
      w: 12.1,
      h: 0.7,
      fontFace: "Arial",
      fontSize: 25,
      bold: true,
      color: "17201B",
      fit: "shrink",
    });

    slide.addText(slideBodyText(item), {
      x: 0.85,
      y: 1.55,
      w: 11.5,
      h: 2.2,
      fontFace: "Arial",
      fontSize: 22,
      color: "27362F",
      breakLine: false,
      fit: "shrink",
    });

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
  return slide.blocks
    .flatMap((block) => (block.type === "bullets" ? block.items : "content" in block ? [block.content] : []))
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
}

function escapePdf(value: string) {
  return value.replace(/[()\\]/g, "");
}
