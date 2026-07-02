import type { Job } from "bullmq";
import { ensureEditableCanvas, type Source } from "@studydeck/shared";
import { getPrisma } from "../prisma.js";
import { readObjectBuffer } from "../storage.js";
import { extractTextFromSource } from "./extract.js";
import { enrichPresentationImages } from "./image-search.js";
import { generateNarrationDraft, generatePresentationFromNarration } from "./presentation.js";
import { searchWebSources } from "./web-search.js";

export async function handleGenerationJob(job: Job<{ projectId: string; userId: string }>) {
  const prisma = getPrisma();
  const { projectId } = job.data;
  const kind = job.name === "generate-narration" ? "narration" : "presentation";

  await prisma.project.update({
    where: { id: projectId },
    data: { status: kind === "narration" ? "script_generating" : "generating", error: null },
  });
  await prisma.generationJob.updateMany({ where: { projectId, queueJobId: job.id, kind }, data: { status: "active" } });

  try {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { sources: true } });
    const sources = await prepareGenerationSources(project);

    if (kind === "narration") {
      const draft = await generateNarrationDraft(project, sources);
      await prisma.project.update({
        where: { id: projectId },
        data: {
          speechDraft: draft.text,
          speechDraftUpdatedAt: new Date(),
          status: "script_ready",
          error: null,
        },
      });
      await prisma.generationJob.updateMany({ where: { projectId, queueJobId: job.id, kind }, data: { status: "completed" } });
      return;
    }

    if (!project.speechDraft?.trim()) {
      throw new Error("No accepted speech text was found for presentation generation");
    }

    const generatedPresentation = await generatePresentationFromNarration(project, sources, project.speechDraft);
    const presentation = ensureEditableCanvas(await enrichPresentationImages(project, generatedPresentation));
    await prisma.presentation.upsert({
      where: { projectId },
      create: { projectId, document: presentation },
      update: { document: presentation },
    });
    await prisma.project.update({ where: { id: projectId }, data: { status: "ready" } });
    await prisma.generationJob.updateMany({ where: { projectId, queueJobId: job.id, kind }, data: { status: "completed" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    await prisma.project.update({ where: { id: projectId }, data: { status: "failed", error: message } });
    await prisma.generationJob.updateMany({ where: { projectId, queueJobId: job.id, kind }, data: { status: "failed", error: message } });
    throw error;
  }
}

export async function prepareGenerationSources(project: {
  id: string;
  prompt: string;
  mode: string;
  speechDraft?: string | null;
  sources: Array<{
    id: string;
    label: string;
    type: string;
    size: number;
    objectKey: string | null;
    url: string | null;
    excerpt: string;
    text: string;
  }>;
}) {
  const sources: Source[] = [];

  for (const source of project.sources) {
    if (source.type === "WEB") {
      continue;
    }

    if (!source.objectKey) {
      if (source.excerpt || source.text) {
        sources.push({
          id: source.id,
          label: source.label,
          type: source.type,
          size: source.size,
          excerpt: source.excerpt || makeExcerpt(source.text, project.prompt),
          url: source.url || undefined,
        });
      }
      continue;
    }

    const buffer = await readObjectBuffer(source.objectKey);
    const text = cleanText(await extractTextFromSource(source.label, buffer)).slice(0, 9000);
    const excerpt = makeExcerpt(text, project.prompt);
    const prisma = getPrisma();
    const updated = await prisma.source.update({ where: { id: source.id }, data: { text, excerpt } });
    sources.push({
      id: updated.id,
      label: updated.label,
      type: updated.type,
      size: updated.size,
      objectKey: updated.objectKey || undefined,
      excerpt: updated.excerpt,
      url: updated.url || undefined,
    });
  }

  if (!sources.length || project.mode === "with_sources") {
    const prisma = getPrisma();
    await prisma.source.deleteMany({ where: { projectId: project.id, type: "WEB" } });
    const webSources = await searchWebSources(project.prompt);

    for (const source of webSources) {
      const created = await prisma.source.create({
        data: {
          projectId: project.id,
          label: source.label,
          type: source.type,
          excerpt: source.excerpt,
          text: source.excerpt,
          url: source.url,
        },
      });

      sources.push({
        id: created.id,
        label: created.label,
        type: created.type,
        size: created.size,
        objectKey: created.objectKey || undefined,
        excerpt: created.excerpt,
        url: created.url || undefined,
      });
    }
  }

  if (!sources.length && project.speechDraft?.trim()) {
    const text = cleanText(project.speechDraft).slice(0, 9000);
    sources.push({
      id: `${project.id}-accepted-speech`,
      label: "Accepted speech text",
      type: "PROMPT",
      size: text.length,
      excerpt: makeExcerpt(text, project.prompt) || text.slice(0, 1100),
    });
  }

  if (!sources.length) {
    throw new Error("No source material was found for generation");
  }

  return sources;
}

function cleanText(value: string) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function makeExcerpt(text: string, prompt: string) {
  const sentences = cleanText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const promptWords = new Set(cleanText(prompt).toLowerCase().split(/\s+/).filter((word) => word.length > 4));
  return sentences
    .map((sentence) => ({
      sentence,
      score: sentence.toLowerCase().split(/\s+/).reduce((sum, word) => sum + (promptWords.has(word) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.sentence)
    .join(" ")
    .slice(0, 1100);
}
