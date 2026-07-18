import { z } from "zod";
import { contentPlaceholderSchema } from "../defense/schemas.js";
import { generationBriefSchema } from "../generation/schemas.js";
import { slideBlockSchema, slideCanvasSchema, slideLayoutSchema, slideVisualSchema } from "../presentation/schemas.js";
import { folderColorSchema, projectMemberRoleSchema, projectStatusSchema, scenarioSchema } from "./schemas.js";
export const createProjectInputSchema = z.object({
  title: z.string().min(2).max(140),
  prompt: z.string().min(18).max(12000),
  scenario: scenarioSchema,
  level: z.string().min(2).max(80),
  mode: z.enum(["fast_draft", "with_sources", "explain_simpler"]),
  slideCount: z.number().int().min(4).max(20),
  generationBrief: generationBriefSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const folderNameSchema = z.string().trim().min(1).max(80);

export const createFolderInputSchema = z
  .object({
    name: folderNameSchema,
    color: folderColorSchema.default("orange"),
  })
  .strict();
export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;

export const updateFolderInputSchema = z
  .object({
    name: folderNameSchema.optional(),
    color: folderColorSchema.optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one folder field is required",
  });
export type UpdateFolderInput = z.infer<typeof updateFolderInputSchema>;

const optionalFolderIdSchema = z.string().trim().min(1).max(128).nullable().optional();

export const updateProjectMetadataInputSchema = z
  .object({
    title: z.string().trim().min(1).max(140).optional(),
    folderId: optionalFolderIdSchema,
  })
  .strict()
  .refine((value) => value.title !== undefined || value.folderId !== undefined, {
    message: "At least one project field is required",
  });
export type UpdateProjectMetadataInput = z.infer<typeof updateProjectMetadataInputSchema>;

export const duplicateProjectInputSchema = z
  .object({
    title: z.string().trim().min(1).max(140).optional(),
    folderId: optionalFolderIdSchema,
  })
  .strict();
export type DuplicateProjectInput = z.infer<typeof duplicateProjectInputSchema>;

export const createProjectInvitationInputSchema = z
  .object({
    role: projectMemberRoleSchema,
  })
  .strict();
export type CreateProjectInvitationInput = z.infer<typeof createProjectInvitationInputSchema>;

export const updateProjectMemberInputSchema = z
  .object({
    role: projectMemberRoleSchema,
  })
  .strict();
export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberInputSchema>;

const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const projectListQuerySchema = z
  .object({
    scope: z.enum(["all", "mine", "shared"]).default("all"),
    folderId: z.preprocess(emptyStringToUndefined, z.string().trim().min(1).max(128).optional()),
    status: z.preprocess(emptyStringToUndefined, projectStatusSchema.optional()),
    search: z.preprocess(emptyStringToUndefined, z.string().trim().max(140).optional()),
    sort: z.enum(["updated_desc", "created_desc", "title_asc"]).default("updated_desc"),
    cursor: z.preprocess(emptyStringToUndefined, z.string().trim().min(1).max(500).optional()),
    limit: z.coerce.number().int().min(1).max(100).default(24),
  })
  .strict();
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const updateSlideInputSchema = z.object({
  expectedRevision: z.number().int().min(1),
  title: z.string().min(1).max(160).optional(),
  thesis: z.string().max(360).optional(),
  bullets: z.array(z.string().trim().min(1).max(1000)).max(5).optional(),
  layout: slideLayoutSchema.optional(),
  visual: slideVisualSchema.optional(),
  blocks: z.array(slideBlockSchema).optional(),
  placeholders: z.array(contentPlaceholderSchema).max(50).optional(),
  canvas: slideCanvasSchema.optional(),
  speakerNotes: z.string().max(5000).optional(),
});
export type UpdateSlideInput = z.infer<typeof updateSlideInputSchema>;

export const updateNarrationInputSchema = z.object({
  speechDraft: z.string().min(50).max(60000),
  accept: z.boolean().default(false),
});
export type UpdateNarrationInput = z.infer<typeof updateNarrationInputSchema>;

export const generatePresentationInputSchema = updateNarrationInputSchema.partial();
export type GeneratePresentationInput = z.infer<typeof generatePresentationInputSchema>;
