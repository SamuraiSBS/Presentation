# Plan 02b — native-first editable slides

## Verdict

**NATIVE-FIRST NO-GO**

This is one free, isolated PDF remediation proof only. The prior independent PDF hard failure is repaired: all three real `slide.pdf` files now preserve the canonical native canvas closely enough for the explicit title scale/wrap/position, supporting text, structured evidence, page number, crop, and no-new-overlap checks to pass. Each PDF retains the exact semantic strings in its native text layer.

The overall Plan 02b gate remains NO-GO. This authorised, isolated renderer proof selected the only installed local adapter, Microsoft PowerPoint COM `Slide.Export` from Microsoft Office 2013 `15.0.5579.1001`. The single read-only attempt did not create `solar-01/pptx-render.png` in 30.2 seconds; its exact record is `D:\presentation\.codex-artifacts\image-first-editable-slides-v1\native-first-proof\pptx-render-attempt.log`. A subsequent no-file health diagnostic proved that COM startup itself did not return in 10.2 seconds, before any PPTX was opened; see `pptx-render-health-check.log`. A visible ordinary launch confirmed `PowerPoint (Сбой активации продукта)`. After the user reported activation, a clean-process COM preflight still did not return in 10.2 seconds; the local `OSPP.VBS /dstatus` check returned `ERROR DESCRIPTION: An unknown error occurred.` Per scope, no PPTX retry, activation, second adapter, or export was attempted, so a real PPTX visual render and the four-panel comparison remain absent.

## Scope and cost

- production routing changed: no
- PDF canvas/export path changed: yes, minimally; HTML style attributes are escaped, native canvas text is not clipped by its nominal element box, and the proof has an isolated canvas-compatible font bridge
- paid calls: 0
- provider, OCR, image, billing, feature-flag, queue, composition, semantic string, reference-asset, and PPTX-renderer code changes: no
- renderer proof: one existing local PowerPoint COM adapter only; `pptx-render-adapter.json` records identity/version; no network, new PPTX, or fallback adapter
- commit/deploy: no
- dirty-tree boundary: pre-existing tracked/untracked changes were preserved; this remediation touched only the PDF canvas/export bridge, the native-first proof/test, refreshed proof artifacts, and this report

## 3-fixture acceptance

| fixture | visual 5/5 | editor | PDF | PPTX | exact strings | raster-text violations | result | artifacts |
|---|---|---|---|---|---:|---:|---|---|
| solar-01 | not reviewed; PPTX render unavailable | PASS | PASS: title/supporting/structured/page/crop/overlap parity and PDF text layer | FAIL: PowerPoint COM did not create render | 16/16 | 0 | NATIVE-FIRST NO-GO | `D:\presentation\.codex-artifacts\image-first-editable-slides-v1\native-first-proof\solar-01\` |
| porsche-01 | not reviewed; invocation stopped after solar failure | PASS | PASS: title/supporting/structured/page/crop/overlap parity and PDF text layer | NOT ATTEMPTED: fallback forbidden | 4/4 | 0 | NATIVE-FIRST NO-GO | `D:\presentation\.codex-artifacts\image-first-editable-slides-v1\native-first-proof\porsche-01\` |
| nature-01 | not reviewed; invocation stopped after solar failure | PASS | PASS: title/supporting/structured/page/crop/overlap parity and PDF text layer | NOT ATTEMPTED: fallback forbidden | 12/12 | 0 | NATIVE-FIRST NO-GO | `D:\presentation\.codex-artifacts\image-first-editable-slides-v1\native-first-proof\nature-01\` |

Aggregate result: `D:\presentation\.codex-artifacts\image-first-editable-slides-v1\native-first-proof\summary.json`.

## Native/raster inventory

| fixture | native background/shapes/diagrams | allowed raster assets and hashes | forbidden-raster check |
|---|---|---|---|
| solar-01 | dark field, halo, orbital geometry, planet markers and timeline | none | PASS — canonical canvas has shape/text only |
| porsche-01 | black/red fields, native vehicle geometry, wheels, lamp and speed lines | none | PASS — canonical canvas has shape/text only |
| nature-01 | light terrain, river/map diagram, contours, markers and rule | none | PASS — canonical canvas has shape/text only |

## Editor, PDF and PPTX evidence

For every fixture directory above, the refreshed evidence is:

- `slide.pdf` — real Chromium PDF, not a PNG substitute;
- `pdf-text-extraction.txt` — normalized native PDF text extraction;
- `pdf-render.png` — Poppler render of that `slide.pdf`;
- `editor-vs-pdf.png` — compact editor | actual-PDF visual comparison;
- `pdf-visual-parity.json` — machine-readable per-element title scale/wrap/position, supporting text, structured evidence, page-number, crop, and overlap result.

The `nature-01` PDF now contains the formerly clipped map label `Ростовская область` in both its visible render and text extraction. The machine-readable checks record pre-existing canonical text-box overlaps, but no overlap introduced by the PDF route.

PPTX evidence remains structural-only: `slide.pptx` and `pptx-text-runs.json`. The single allowed PowerPoint COM attempt created no `pptx-render.png`; therefore no `pptx-render.pdf`, visual review, or four-panel `side-by-side.png` was created or claimed. The adapter identity and exact failure record are `pptx-render-adapter.json` and `pptx-render-attempt.log` at the native-first proof root.

## Tests and commands

| command | result |
|---|---|
| `npm run test -w @studydeck/worker -- native-first-proof.test.ts --reporter=verbose` | PASS — 2 tests |
| `npm run typecheck -w @studydeck/worker` | PASS |
| `node --import tsx apps\worker\src\tasks\presentation\image-first-editable-v1\native-first-proof.ts` | PASS for the scoped PDF remediation: 3/3 PDF parity and text-layer checks; no PPTX visual render |
| `git -c safe.directory=D:/presentation diff --check` | PASS (exit 0); only pre-existing unrelated LF/CRLF warnings |
| `Microsoft PowerPoint COM Slide.Export` for `solar-01/slide.pptx` | FAIL — 30.2 seconds, stdout/stderr empty, no PNG; see `pptx-render-attempt.log`; no second adapter/retry |
| `New-Object -ComObject PowerPoint.Application` health check | FAIL — 10.2 seconds, stdout/stderr empty before a PPTX operation; see `pptx-render-health-check.log` |
| post-activation `New-Object -ComObject PowerPoint.Application` from a clean process | FAIL — 10.2 seconds, stdout/stderr empty before a PPTX operation; see `pptx-render-health-check.log` |
| `OSPP.VBS /dstatus` | FAIL — `ERROR DESCRIPTION: An unknown error occurred.` |

## GO/NO-GO rationale

- The original PDF defect was an invalid unescaped `font-family` inside an HTML `style` attribute. It terminated the attribute before `font-size`, so real PDF text fell back to browser-default sizing.
- Escaping PDF canvas style attributes restores the native font-size, weight, line height, and position properties. Allowing native text to remain visible beyond a too-short nominal box preserves the same semantic lines the editor canvas already shows; it does not rasterize text.
- All three refreshed `pdf-visual-parity.json` files pass the requested PDF checks, and all three `pdf-text-extraction.txt` files retain the exact semantic content.
- The Plan 02b aggregate cannot be GO without a real PPTX render. This proof supplied one fresh allowed adapter attempt, but it created no `solar-01/pptx-render.png`; the remaining two inputs were correctly not attempted and the absence of a render prevents a human PPTX visual review.
- The failure is earlier than `Slide.Export`: the PowerPoint COM application factory did not return control before any deck was opened. First-run registry markers were already complete and the application event log had no fresh PowerPoint error. The visible application title confirmed `Сбой активации продукта`; a clean-process check still failed after user-reported activation and the local licensing-status script returned an unknown error. Office repair/licensing support remains outside this proof.

## Only next step

STOP. The authorised one-adapter remediation is complete and failed. Do not retry PowerPoint, select another adapter, start Plan 03, or run a paid/provider experiment from this result.
