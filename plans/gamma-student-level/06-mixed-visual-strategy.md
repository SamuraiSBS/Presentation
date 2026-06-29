# Prompt 06: Mixed image and diagram strategy

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Improve visual enrichment so StudyDeck uses both real images and deterministic diagrams intentionally.

## Goal

The user wants both pictures and schemes/diagrams. The generator should not search for an image for every slide, and it should not turn every idea into a generic diagram.

Use the best visual mode for each slide:

- real photo or sourced image for concrete people, places, objects, events, artifacts, products, or scenes;
- diagram for concepts, causes, processes, comparisons, structures, and systems;
- text-led statement for strong claims;
- evidence board for sourced arguments;
- no major visual when the slide should stay focused and minimal.

## Current project context

- Image enrichment lives in `apps/worker/src/tasks/image-search.ts`.
- It uses Tavily and stores downloaded images in MinIO.
- `DesignBrief.slideDirections` already has `imageStrategy`.
- Slide canvas generation lives in `packages/shared/src/index.ts`.
- Export image reading lives in `apps/worker/src/tasks/export.ts`.

## Visual strategy rules

Use `real_photo` when:

- the slide refers to a real person, place, object, company, event, work of art, historical scene, lab object, product, or environment;
- an image would make the slide more memorable;
- the query can be concrete and searchable.

Use `diagram` when:

- the slide explains a process;
- the slide compares two or more ideas;
- the slide explains cause and effect;
- the slide maps a concept;
- the slide needs a timeline or structure.

Use `none` or text-led layout when:

- the slide is a strong thesis;
- the topic is abstract and a random stock image would weaken it;
- source quality is thin;
- the slide is a final takeaway.

## Implementation steps

1. Update `buildDesignBriefPrompt(...)`.
   - Ask for `imageStrategy` per slide.
   - Require concrete `visualPrompt`.
   - Tell the model not to request images for abstract slides.

2. Update deterministic `buildDesignBrief(...)`.
   - Infer image vs diagram from narrative plan and source text.
   - Keep a balanced deck:
     - 20-40 percent photo/image slides for most decks;
     - diagrams for explanation-heavy slides;
     - no forced image on every slide.

3. Update `enrichPresentationImages(...)`.
   - Only search/download images when the slide direction says `real_photo` or `generated_illustration` and the slide has a concrete visual prompt.
   - Skip image enrichment for diagram/text-led slides.
   - Keep used URL/domain deduping.

4. Update `buildSlideImageQuery(...)`.
   - Prefer `designBrief.slideDirections[].visualPrompt` if available.
   - Keep queries short and concrete.
   - Avoid generic "educational presentation image" if a better subject exists.

5. Update canvas generation.
   - For diagram slides, ensure `buildSlideCanvas(...)` renders useful shapes, labels, timelines, comparison boards, or evidence boards without needing external images.

6. Update tests.
   - Image search is not called for diagram-only slides.
   - Image search is called for concrete `real_photo` slides.
   - Generated query uses visual prompt.
   - Diagram slides still produce canvas elements without image data.

## Tests

Run:

```powershell
npm run test -w @studydeck/worker -- src/tasks/image-search.test.ts
npm run test -w @studydeck/worker -- src/tasks/presentation.test.ts
npm run build -w @studydeck/shared
npm run test -w @studydeck/shared
npm run typecheck -w @studydeck/worker
```

## Acceptance criteria

- The system chooses images and diagrams intentionally.
- Tavily is not called for every slide by default.
- Diagram slides remain visually rich without external assets.
- Export still works when some slides have images and others do not.

## Non-goals

- Do not implement AI image generation in this plan.
- Do not require Tavily for all decks.
- Do not remove existing MinIO image storage.

