# Prompt 01: Student-only creation brief

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Implement the first step toward Gamma-level output: make the product generation flow focused only on university students, and collect a structured creation brief that tells the generator how to create short beautiful slides with most of the explanation in speaker notes.

## Goal

StudyDeck should stop behaving like a generic school/teacher presentation generator. The default and primary product position is:

- audience: university students;
- output: academic but easy-to-present study presentations;
- slide density: short, beautiful, not text-heavy;
- speech: clear, human, professional, readable aloud;
- visuals: a mix of images, schemes, diagrams, and text-led slides;
- parity: web preview and PPTX/PDF export matter equally.

This plan intentionally narrows the product. Do not add separate school, teacher, or child-oriented modes in this step.

## Current project context

- Creation UI lives in `apps/web/src/components/new-project-form.tsx`.
- Project creation contracts live in `packages/shared/src/index.ts`.
- API project creation lives in `apps/api/src/projects/projects.service.ts`.
- Prisma stores `Project.scenario`, `Project.level`, `Project.mode`, and `Project.prompt`.
- Worker generation receives `project.scenario`, `project.level`, `project.mode`, `project.prompt`, and `project.slideCount` in `apps/worker/src/tasks/presentation.ts`.
- The current UI hardcodes `scenario: "school_report"`, `level: "8-11 класс"`, and `mode: "with_sources"`.

## Required product behavior

The `/new` flow should ask only what is useful for a university student:

1. Topic or assignment.
2. Slide count / presentation length.
3. Source materials.
4. Brief settings:
   - study level: `university_student`;
   - speech style: `easy_professional`;
   - slide density: `brief_slides_full_speech`;
   - visual strategy: `images_and_diagrams`;
   - export target: `web_and_pptx_pdf`;

The user should not see school/teacher mode choices. If there are visible labels, they should describe university student work, not classroom school reports.

## Suggested shared contract

Add a small structured object if it fits the existing contract:

```ts
export const generationBriefSchema = z.object({
  audience: z.enum(["university_student"]).default("university_student"),
  speechStyle: z.enum(["easy_professional"]).default("easy_professional"),
  slideDensity: z.enum(["brief_slides_full_speech"]).default("brief_slides_full_speech"),
  visualStrategy: z.enum(["images_and_diagrams"]).default("images_and_diagrams"),
  exportTarget: z.enum(["web_and_pptx_pdf"]).default("web_and_pptx_pdf"),
});
```

Preferred first implementation:

- Add `generationBrief` to the project creation request and to `PresentationDocument` only if the persistence path is straightforward.
- If avoiding a Prisma migration is preferred, encode the brief into existing `scenario`, `level`, and `mode` fields in a stable way:
  - `scenario: "university_report"`;
  - `level: "university_student"`;
  - `mode: "with_sources"`;
  - prompt includes the brief as plain text.

Do not add a DB migration unless the implementation needs to query the brief separately later.

## Implementation steps

1. Update `apps/web/src/components/new-project-form.tsx`.
   - Replace school-oriented labels with university-student labels.
   - Keep the flow simple and fast.
   - Keep slide count options, but label them for university presentations.
   - Create projects with student-only values.

2. Update shared contracts in `packages/shared/src/index.ts` if adding `generationBrief`.
   - Keep old projects readable.
   - Do not break existing `createProjectInputSchema`.

3. Update prompts in `apps/worker/src/tasks/presentation.ts`.
   - Treat `university_student` as the default audience.
   - Make the generator prefer short visible slide text and richer speaker notes.
   - Keep the accepted narration as the source of truth.

4. Update demo or display defaults if they still imply school audience.

5. Add tests.
   - Web test or component-level test if available for `/new` payload shape.
   - Shared schema test if the contract changes.
   - Worker prompt test asserting the prompt includes university student, brief slides, full speech, images and diagrams.

## Acceptance criteria

- New projects are created for university students by default.
- The user is not asked to choose school or teacher modes.
- The generated prompt clearly instructs short slides plus full speech.
- Existing saved projects still parse and display.
- `npm run typecheck -w @studydeck/web` passes.
- If shared or worker contracts change:
  - `npm run build -w @studydeck/shared`;
  - `npm run test -w @studydeck/shared`;
  - `npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts`.

## Non-goals

- Do not build a full persona system.
- Do not add teacher or school presets.
- Do not redesign the whole dashboard.
- Do not change export behavior in this plan.

