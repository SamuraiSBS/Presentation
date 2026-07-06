# Prompt 10: Sharp image processing

You are working in the StudyDeck AI monorepo at `D:\presentation`.

Use `sharp` to improve downloaded presentation images before storing and exporting. `sharp` is already installed.

## Goal

Make image slides more reliable and export-friendly:

- resize oversized images;
- normalize format;
- compress safely;
- generate dimensions/metadata;
- avoid huge MinIO objects;
- preserve image quality for presentation use.

## Current project context

- Image search/download logic lives in worker tasks.
- MinIO stores downloaded presentation visuals.
- Export uses images in PPTX/PDF.
- Web rendering expects usable image URLs or object keys.

## Implementation steps

1. Find image download and MinIO upload code.

2. Add a helper:

```ts
processPresentationImage(buffer, options)
```

It should return:

- processed buffer;
- content type;
- width;
- height;
- byte size;
- optional warnings.

3. Enforce env-configurable limits:
   - max bytes;
   - max width/height;
   - timeout already present if applicable.

4. Prefer JPEG or WebP for photos, PNG only when transparency or diagrams need it.

5. Store metadata with visual references if the existing contract allows it.

6. Make export logic use dimensions when available.

7. If processing fails, fall back safely:
   - use original only if within limits;
   - otherwise skip image and keep text/diagram fallback.

## Tests

Add worker tests using small fixture images or generated buffers.

Run:

```powershell
npm run test -w @studydeck/worker
npm run typecheck -w @studydeck/worker
```

## Acceptance criteria

- Oversized images are resized before upload.
- Image metadata is available for rendering/export.
- Broken images do not fail the whole presentation job.
- Existing image search behavior remains optional.

## Non-goals

- Do not add AI image generation.
- Do not process every export asset repeatedly if already processed.
- Do not require images for abstract slides.

