import { ensureEditableCanvas, presentationSchema } from "@studydeck/shared";
import { getPrisma } from "../prisma.js";
import { materializePlannedVisuals } from "../tasks/presentation-quality.js";

const projectIdFlag = "--project-id";
const projectIdIndex = process.argv.indexOf(projectIdFlag);
const projectId = projectIdIndex >= 0 ? process.argv[projectIdIndex + 1]?.trim() : "";
const refreshDiagramFallbacks = process.argv.includes("--refresh");

if (!projectId) {
  throw new Error(`Usage: node dist/maintenance/backfill-planned-visuals.js ${projectIdFlag} <project-id>`);
}

async function main() {
  const prisma = getPrisma();
  try {
    const record = await prisma.presentation.findUniqueOrThrow({ where: { projectId } });
    const original = presentationSchema.parse(record.document);
    const materialized = materializePlannedVisuals(original, { refreshDiagramFallbacks });
    const changedOrders = materialized.slides
      .filter((slide, index) => JSON.stringify(slide.visual) !== JSON.stringify(original.slides[index]?.visual))
      .map((slide) => slide.order);

    if (!changedOrders.length) {
      console.log(JSON.stringify({ projectId, changedOrders: [], revision: record.revision }));
      return;
    }

    const document = ensureEditableCanvas({
      ...materialized,
      slides: materialized.slides.map((slide) => ({ ...slide, canvas: undefined })),
    });
    const updated = await prisma.presentation.update({
      where: { projectId },
      data: { document, revision: { increment: 1 } },
      select: { revision: true },
    });
    console.log(JSON.stringify({ projectId, changedOrders, revision: updated.revision }));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
