import { z } from "zod";

/**
 * Internal export diagnostics. The report is intentionally transient: export
 * repairs must not overwrite the user's editable presentation document.
 */
export const exportPreflightFormatSchema = z.enum(["pptx", "pdf", "web"]);

export const exportPreflightSlideIssueSchema = z.object({
  slideId: z.string(),
  categories: z.array(z.string()).min(1),
  repairable: z.boolean(),
});

export const exportPreflightReportSchema = z.object({
  passed: z.boolean(),
  repaired: z.boolean(),
  format: exportPreflightFormatSchema,
  slideIssues: z.array(exportPreflightSlideIssueSchema),
});

export type ExportPreflightFormat = z.infer<typeof exportPreflightFormatSchema>;
export type ExportPreflightSlideIssue = z.infer<typeof exportPreflightSlideIssueSchema>;
export type ExportPreflightReport = z.infer<typeof exportPreflightReportSchema>;
