import type { Job } from "bullmq";
import { type Source } from "@studydeck/shared";
import { getPrisma } from "../prisma.js";
import { readObjectBuffer } from "../storage.js";
import { extractTextFromSource } from "./extract.js";
import { generatePresentation } from "./presentation.js";

export async function handleGenerationJob(job: Job<{ projectId: string; userId: string }>) {
  const prisma = getPrisma();
  const { projectId } = job.data;

  await prisma.project.update({ where: { id: projectId }, data: { status: "generating", error: null } });
  await prisma.generationJob.updateMany({ where: { projectId, queueJobId: job.id }, data: { status: "active" } });

  try {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { sources: true } });
    const sources: Source[] = [];

    for (const source of project.sources) {
      const buffer = await readObjectBuffer(source.objectKey);
      const text = cleanText(await extractTextFromSource(source.label, buffer)).slice(0, 9000);
      const excerpt = makeExcerpt(text, project.prompt);
      const updated = await prisma.source.update({ where: { id: source.id }, data: { text, excerpt } });
      sources.push({
        id: updated.id,
        label: updated.label,
        type: updated.type,
        size: updated.size,
        objectKey: updated.objectKey,
        excerpt: updated.excerpt,
      });
    }

    const presentation = await generatePresentation(project, sources);
    await prisma.presentation.upsert({
      where: { projectId },
      create: { projectId, document: presentation },
      update: { document: presentation },
    });
    await prisma.project.update({ where: { id: projectId }, data: { status: "ready" } });
    await prisma.generationJob.updateMany({ where: { projectId, queueJobId: job.id }, data: { status: "completed" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    await prisma.project.update({ where: { id: projectId }, data: { status: "failed", error: message } });
    await prisma.generationJob.updateMany({ where: { projectId, queueJobId: job.id }, data: { status: "failed", error: message } });
    throw error;
  }
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
