import { z } from "zod";
import { sourceSchema } from "../projects/schemas.js";
import { designBriefSchema, slideNarrativeSchema } from "../generation/schemas.js";
import { presentationThemeSchema, slideSchema, speechScriptItemSchema } from "./schemas.js";
export const productionQualityGateSchema = z.object({
  version: z.literal(1),
  capability: z.literal("silent-production-quality-gate"),
  recoveryApplied: z.boolean().optional(),
  recoveryStage: z.enum(["accepted_narration", "canvas_layout", "emergency"]).optional(),
  recoveryReason: z.string().trim().max(240).optional(),
  replacedImages: z.number().int().nonnegative().optional(),
  replacedDiagrams: z.number().int().nonnegative().optional(),
});
export const presentationSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string(),
  level: z.string(),
  slideCount: z.number().int().positive(),
  generationMode: z.enum(["openai", "yandex", "aitunnel", "local", "demo", "demo-fallback"]),
  generatedText: z.string().default(""),
  sources: z.array(sourceSchema),
  outline: z.array(z.string()),
  narrativePlan: z.array(slideNarrativeSchema).default([]),
  presentationTheme: presentationThemeSchema.optional(),
  designBrief: designBriefSchema.optional(),
  // Absent means a saved legacy deck. New documents receive this capability
  // only after the worker's final release audit has accepted their canonical
  // content, so consumers never have to guess from generationMode alone.
  productionQualityGate: productionQualityGateSchema.optional(),
  speechScript: z.array(speechScriptItemSchema),
  slides: z.array(slideSchema),
});
export type PresentationDocument = z.infer<typeof presentationSchema>;
