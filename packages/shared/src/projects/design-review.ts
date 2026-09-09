import { z } from "zod";
import { presentationSchema } from "../presentation/document.js";
import { canvasDiagramModelSchema, slideCanvasSchema } from "../presentation/schemas.js";

export const designCandidateStatusSchema = z.enum(["pending", "approved", "regenerating", "failed"]);
export const designReviewStatusSchema = z.enum(["active", "finalizing", "failed"]);
export const designReviewCandidateSchema = z.object({
  id: z.string(), slideId: z.string(), slideOrder: z.number().int().positive(), version: z.number().int().positive(),
  status: designCandidateStatusSchema, canvas: slideCanvasSchema, visualAssets: z.array(z.string()).nullable().default([]),
  diagramModel: canvasDiagramModelSchema.nullable().optional(), comment: z.string().nullable().optional(), error: z.string().nullable().optional(),
});
export const designReviewSchema = z.object({
  id: z.string(), projectId: z.string(), revision: z.number().int().positive(), status: designReviewStatusSchema,
  document: presentationSchema, candidates: z.array(designReviewCandidateSchema), error: z.string().nullable().optional(),
});
export type DesignReview = z.infer<typeof designReviewSchema>;
export type DesignReviewCandidate = z.infer<typeof designReviewCandidateSchema>;
