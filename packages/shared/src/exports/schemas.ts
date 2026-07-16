import { z } from "zod";
export const exportTypeSchema = z.enum(["pdf", "pptx"]);
export type ExportType = z.infer<typeof exportTypeSchema>;

export const exportStatusSchema = z.enum(["queued", "processing", "ready", "failed"]);
export type ExportStatus = z.infer<typeof exportStatusSchema>;
