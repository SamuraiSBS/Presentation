# Prompt 05: Tiptap text editor

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Add Tiptap for minimal text editing of generated slides and speaker speech. Do not build a full visual slide editor.

## Goal

Let users edit:

- slide title;
- short visible slide text;
- bullet text;
- speaker notes or speech script.

The editor should support clean text editing for Russian university presentations without drag/drop, layers, or manual design tools.

## Current project context

- Web app lives in `apps/web`.
- Presentation rendering lives around `apps/web/src/lib/presentation-display.ts`.
- Editor pages/components live under `apps/web/src`.
- Shared presentation contract lives in `packages/shared/src/index.ts`.
- The richer slide canvas/export contract must stay intact.

## Dependencies

Check current Tiptap docs before installing.

Likely packages:

```powershell
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder
```

Install only what the implementation needs.

## Implementation steps

1. Inspect current editor UI and API save flow.

2. Add a reusable component:
   - `apps/web/src/components/editor/rich-text-field.tsx`;
   - or a location matching existing component structure.

3. Keep storage format simple:
   - plain text or limited markdown-like text if current presentation schema expects strings;
   - do not store arbitrary ProseMirror JSON unless shared contracts and exports are updated.

4. Add small toolbar controls only if useful:
   - bold;
   - italic;
   - bullet list;
   - undo/redo.

5. Use icons from `lucide-react` for toolbar buttons.

6. Wire Tiptap into slide text fields and speech notes without changing visual canvas behavior.

7. Ensure changes persist through existing API routes.

8. Make sure exported PPTX/PDF still use the updated text.

## UX rules

- Text editing should feel quiet and focused.
- Do not show instructional text about how to use the editor.
- Keep slide visible text short; speech can be longer.
- The user should not have to understand the internal slide JSON.

## Tests

Run:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
```

If export text paths changed:

```powershell
npm run typecheck -w @studydeck/worker
```

For visual verification:

```powershell
npm run dev:web:fast
```

Verify at `http://localhost:3020`.

## Acceptance criteria

- Users can edit generated text and speech.
- Saved edits survive reload.
- The slide renderer and exports reflect edits.
- No full canvas editor is introduced.

## Non-goals

- Do not add drag/drop slide editing.
- Do not store complex editor JSON unless absolutely necessary.
- Do not redesign the whole editor page.

