import { z } from "zod";
import { deckStyleSpecSchema, slideContentLockSchema } from "../generation/schemas.js";
import { presentationSchema } from "../presentation/document.js";
import { canvasDiagramModelSchema, slideCanvasSchema } from "../presentation/schemas.js";

export const designCandidateStatusSchema = z.enum(["pending", "approved", "regenerating", "failed"]);
export const designReviewStatusSchema = z.enum(["active", "finalizing", "failed"]);
const qualityCheckSchema = z.object({ passed: z.boolean(), detail: z.string().trim().max(600).default("") });
export const candidateQualityReportSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  hardChecks: z.object({
    textMatchesContentLock: qualityCheckSchema,
    noBakedTextInBackground: qualityCheckSchema,
    geometrySafe: qualityCheckSchema,
    editableElements: qualityCheckSchema,
    diagramValid: qualityCheckSchema,
    assetsAvailable: qualityCheckSchema,
    visualFidelity: qualityCheckSchema,
    noTemplateCardGrid: qualityCheckSchema,
  }),
  softChecks: z.object({
    conceptSimilarity: z.number().min(0).max(100),
    speechRelevance: z.number().min(0).max(100),
    styleConsistency: z.number().min(0).max(100),
  }),
  repairAttempts: z.number().int().min(0).max(1).default(0),
  passed: z.boolean(),
  diagnostics: z.array(z.string().trim().max(600)).max(20).default([]),
});
export type CandidateQualityReport = z.infer<typeof candidateQualityReportSchema>;

export const aiSceneSpecSchema = z.object({
  version: z.literal(2).default(2),
  slideId: z.string().trim().min(1),
  background: z.object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    prompt: z.string().trim().min(12).max(1400),
  }),
  elements: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), id: z.string().trim().min(1), textRef: z.string().trim().min(1), role: z.enum(["title", "thesis", "label", "caption"]), x: z.number().min(0).max(1280), y: z.number().min(0).max(720), w: z.number().positive().max(1280), h: z.number().positive().max(720), fontSize: z.number().int().min(12).max(96), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), align: z.enum(["left", "center", "right"]).default("left"), bold: z.boolean().default(false), zIndex: z.number().int().min(1).max(80).default(10) }),
    z.object({ type: z.literal("shape"), id: z.string().trim().min(1), shape: z.enum(["rect", "roundRect", "ellipse", "line"]), x: z.number().min(0).max(1280), y: z.number().min(0).max(720), w: z.number().positive().max(1280), h: z.number().positive().max(720), fill: z.string().regex(/^#[0-9a-fA-F]{6}$/), stroke: z.string().regex(/^#[0-9a-fA-F]{6}$/), opacity: z.number().min(0).max(1).default(1), zIndex: z.number().int().min(1).max(80).default(5) }),
    z.object({ type: z.literal("diagram"), id: z.string().trim().min(1), x: z.number().min(0).max(1280), y: z.number().min(0).max(720), w: z.number().positive().max(1280), h: z.number().positive().max(720), template: z.enum(["flow", "cycle", "hierarchy"]), nodeRefs: z.array(z.string().trim().min(1)).min(2).max(8), zIndex: z.number().int().min(1).max(80).default(15) }),
  ])).min(3).max(40),
});
export type AiSceneSpec = z.infer<typeof aiSceneSpecSchema>;
export const designReviewCandidateSchema = z.object({
  id: z.string(), slideId: z.string(), slideOrder: z.number().int().positive(), version: z.number().int().positive(),
  status: designCandidateStatusSchema, canvas: slideCanvasSchema, visualAssets: z.array(z.string()).nullable().default([]),
  diagramModel: canvasDiagramModelSchema.nullable().optional(), comment: z.string().nullable().optional(), error: z.string().nullable().optional(),
  conceptObjectKey: z.string().nullable().optional(), renderedPreviewObjectKey: z.string().nullable().optional(),
  sceneSpec: aiSceneSpecSchema.nullable().optional(), contentLock: slideContentLockSchema.nullable().optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), qualityReport: candidateQualityReportSchema.nullable().optional(),
  providerMetadata: z.record(z.unknown()).nullable().optional(), engine: z.enum(["template", "ai_scene_v2"]).default("template"),
  generationDurationMs: z.number().int().nonnegative().nullable().optional(),
});
export const designReviewSchema = z.object({
  id: z.string(), projectId: z.string(), revision: z.number().int().positive(), status: designReviewStatusSchema,
  document: presentationSchema, candidates: z.array(designReviewCandidateSchema), error: z.string().nullable().optional(),
  deckStyleSpec: deckStyleSpecSchema.nullable().optional(), designEngine: z.enum(["template", "ai_scene_v2"]).default("template"), styleVersion: z.number().int().positive().default(1),
});
export type DesignReview = z.infer<typeof designReviewSchema>;
export type DesignReviewCandidate = z.infer<typeof designReviewCandidateSchema>;
