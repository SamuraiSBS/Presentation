import { z } from "zod";
export const exportTypeSchema = z.enum(["pdf", "pptx"]);
export type ExportType = z.infer<typeof exportTypeSchema>;

export const exportStatusSchema = z.enum(["queued", "processing", "ready", "failed"]);
export type ExportStatus = z.infer<typeof exportStatusSchema>;

export const exportWarningAcknowledgementSchema = z
  .object({
    acknowledgeWarnings: z.boolean().default(false),
    complianceReportId: z.string().cuid().optional(),
    preflightToken: z.string().trim().min(16).max(2_000).optional(),
    expectedPresentationRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((acknowledgement, context) => {
    if (!acknowledgement.acknowledgeWarnings) {
      if (
        acknowledgement.complianceReportId ||
        acknowledgement.preflightToken ||
        acknowledgement.expectedPresentationRevision !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["acknowledgeWarnings"],
          message: "Warning credentials require acknowledgeWarnings=true",
        });
      }
      return;
    }
    if (!acknowledgement.complianceReportId && !acknowledgement.preflightToken) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflightToken"],
        message: "Acknowledgement needs a compliance report ID or preflight token",
      });
    }
    if (acknowledgement.expectedPresentationRevision === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedPresentationRevision"],
        message: "Acknowledgement needs the expected presentation revision",
      });
    }
  });
export type ExportWarningAcknowledgement = z.infer<typeof exportWarningAcknowledgementSchema>;

export const createExportInputSchema = z
  .object({
    type: exportTypeSchema.default("pptx"),
    acknowledgement: exportWarningAcknowledgementSchema.optional(),
  })
  .strict();
export type CreateExportInput = z.infer<typeof createExportInputSchema>;
