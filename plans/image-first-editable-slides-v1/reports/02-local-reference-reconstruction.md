# Plan 02 — local reference reconstruction

## Verdict

**RECONSTRUCTION NO-GO**

The actual reference set contains **18**, not six, raster slides. The visual text-lift gate requires at least 15/18 passes; the deterministic local baseline passed **0/18**. This is not a content-lock failure: all 187 manually recorded, Unicode-normalized gold semantic strings were projected into individual editable native canvas elements exactly. The failure is reconstruction quality: no installed local OCR can independently certify line/glyph geometry or the absence of ghost text, and the only free cleanup baseline (expanded-mask `sharp` blur) visibly destroys integrated image detail and also changes pixels outside the expanded masks. It is therefore unsafe to call the result a viable image-first reconstruction path.

The required exact-count product rule from Plan 01 remains unchanged: if unique accepted-speech material is short, exact N still wins; `repeated_accepted_speech` and `fallback_added` remain explicit immutable provenance and are never represented as new speech-grounded content. This lab consumes known exact strings; it does not generate or reinterpret them.

## Scope and boundary

- Foundation check: `plans/image-first-editable-slides-v1/reports/01-content-lock-and-economics.md` states **FOUNDATION ACCEPTED**.
- No production route, flag, model routing, editor route, export route, feature flag, provider, billing logic, commit, or deploy was changed.
- No GPT Image, Luna, vision API, Tavily, search, image edit, or other paid service was called.
- The sources in `референц слайдов/` were read as buffers only and never edited.
- `tesseract` and `tesseract.js` are not installed. No heavy OCR/CV dependency was added merely to make this lab appear successful.

## Local implementation

The isolated prototype is under `apps/worker/src/tasks/presentation/image-first-editable-v1/`:

- `reference-lab-fixtures.ts` holds the manual gold fixtures: exact strings, stable semantic IDs, kind, planned/gold zone, and decorative-text controls.
- `reference-lab.ts` accepts known exact strings plus planned zones, creates an immutable-background/native-text canvas, produces deterministic mask/blur-cleanup artifacts, evaluates hard fallback gates, and writes per-fixture evidence.
- `reference-lab.test.ts` tests Cyrillic, a two-line text zone, false OCR matching, unexpected text, ghost glyphs, long replacement overflow, unresolved text, structured-evidence fallback, and a common canvas string set for PDF/PPTX projections.

The production-shaped input is `exact strings + semantic IDs + planned semantic zones + raster + visual-family tokens`. The prototype deliberately keeps strings as source of truth. Its only local geometry observation is planned-zone-bounded CV (`0.54` confidence), so it cannot overwrite an exact string with an OCR guess. Confidence below `0.80` is fail-closed.

The canonical lab canvas has a locked cleaned-background image, individually editable semantic `CanvasTextElement`s, and a native locked page number. The focused test calls the existing PDF and PPTX canvas renderers and proves they receive the same exact title string as the editor canvas. No rasterized text is used as the canonical editable representation; PNG previews are evidence only.

## Reference inventory and result

All images are PNG, `1672×941`, sRGB, with no embedded ICC profile. Full SHA-256 inventory and artifact paths are in [summary.json](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/summary.json). The right-hand link in every row is `original | detected zones | mask | cleaned background | native reconstruction | fallback` in that order.

| Fixture | SHA-256 prefix | Gold/native strings | Geometry | Pixel changes outside mask | Fallback reason | Evidence |
|---|---|---:|---:|---:|---|---|
| solar-01 | a40436beb42d | 16/16 | 0.54 | 487,434 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/solar-01/side-by-side.png) |
| solar-02 | 5e7d8e75571f | 12/12 | 0.54 | 297,536 | geometry, ghost | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/solar-02/side-by-side.png) |
| solar-03 | 76f93e9e2f3c | 11/11 | 0.54 | 156,014 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/solar-03/side-by-side.png) |
| solar-04 | 2fcbeda60ed8 | 11/11 | 0.54 | 447,885 | geometry, ghost | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/solar-04/side-by-side.png) |
| solar-05 | 0bef71433c8c | 11/11 | 0.54 | 354,593 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/solar-05/side-by-side.png) |
| solar-06 | 4d0bd12e28d6 | 12/12 | 0.54 | 390,432 | geometry, ghost | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/solar-06/side-by-side.png) |
| porsche-01 | 878ce3be966c | 4/4 | 0.54 | 209,993 | geometry, ghost, damage | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/porsche-01/side-by-side.png) |
| porsche-02 | 8f24b0840835 | 11/11 | 0.54 | 254,881 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/porsche-02/side-by-side.png) |
| porsche-03 | c1b4c9634a3a | 10/10 | 0.54 | 316,513 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/porsche-03/side-by-side.png) |
| porsche-04 | c1c1ecf9f1e5 | 9/9 | 0.54 | 344,221 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/porsche-04/side-by-side.png) |
| porsche-05 | 068f7a792d75 | 7/7 | 0.54 | 338,669 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/porsche-05/side-by-side.png) |
| porsche-06 | 0666e4caf6c8 | 6/6 | 0.54 | 276,637 | geometry, ghost, damage | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/porsche-06/side-by-side.png) |
| nature-01 | 6c813dabfc6f | 12/12 | 0.54 | 327,746 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/nature-01/side-by-side.png) |
| nature-02 | 552bab31b35a | 11/11 | 0.54 | 320,514 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/nature-02/side-by-side.png) |
| nature-03 | e294faf6f5ee | 12/12 | 0.54 | 377,163 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/nature-03/side-by-side.png) |
| nature-04 | 63d43f9105d0 | 11/11 | 0.54 | 297,057 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/nature-04/side-by-side.png) |
| nature-05 | 01fdc6d4e4d9 | 9/9 | 0.54 | 315,841 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/nature-05/side-by-side.png) |
| nature-06 | bc464bfc13d8 | 12/12 | 0.54 | 353,041 | geometry, ghost, damage, structured evidence | [side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/nature-06/side-by-side.png) |

### Measured acceptance

- Exact native string restoration: **187/187 (100%)**, NFC-normalized equality.
- Native element state: every fixture has locked background, editable semantic text, and a locked native page number.
- Editor/PDF/PPTX: the focused parity test passes; PDF HTML and mocked PPTX both receive the canvas’s exact Cyrillic title string.
- Text-lift visual pass: **0/18**; required: **15/18 (80%)**. Fallbacks are intentionally excluded from this metric.
- Ghost check: **18/18 fail closed**. There is no independent local OCR/detection engine to prove that the blurred raster zone has no remaining readable glyphs, so the gate records `cleanup_ghost`, rather than pretending blur is an erasure proof.
- Pixel-boundary check: **18/18 fail**. The `sharp` composite changed 156,014–487,434 pixels outside the expanded mask; that violates the contract even before visual judgement.
- Visual review: the Porsche sample visibly turns title/claim areas into broad blur patches over car and landscape detail; see [Porsche 01 side-by-side](../../../.codex-artifacts/image-first-editable-slides-v1/reference-lab/porsche-01/side-by-side.png). Dense tables/timelines/diagrams were separately sent directly to fully native fallback because their labels and numerical relationships are structured evidence, not candidates for raster recovery.

## Fallback

Every failed candidate has an offline native fallback rendered from the exact gold strings. It uses the fixture’s visual family (dark cosmic, red/black motorsport, or light editorial nature) and varies between statement, flow, comparison, and timeline-like archetypes. It intentionally prints no diagnostic on the slide and incurs no external cost. Fallback output is valid, but it is not counted as a successful text-lift reconstruction.

## Verification

| Command | Result |
|---|---|
| `npx tsx apps/worker/src/tasks/presentation/image-first-editable-v1/reference-lab.ts` | ran offline across 18 local references; `RECONSTRUCTION NO-GO`, 0/18 pass, artifacts and `summary.json` written |
| `npm run typecheck -w @studydeck/worker` | passed |
| `npm run test -w @studydeck/worker -- reference-lab.test.ts` | passed: 1 file, 6 tests |
| `git -c safe.directory=D:/presentation diff --check` | passed; only pre-existing LF→CRLF warnings for unrelated tracked dirty files |

The first sandboxed Vitest/tsx attempts were blocked by Windows `spawn EPERM`; identical local-only reruns were authorized solely to create local child workers. No network or provider call occurred.

## Changed files

- `apps/worker/src/tasks/presentation/image-first-editable-v1/reference-lab-fixtures.ts`
- `apps/worker/src/tasks/presentation/image-first-editable-v1/reference-lab.ts`
- `apps/worker/src/tasks/presentation/image-first-editable-v1/reference-lab.test.ts`
- `.codex-artifacts/image-first-editable-slides-v1/reference-lab/**`
- `plans/image-first-editable-slides-v1/reports/02-local-reference-reconstruction.md`

All pre-existing dirty paths reported before this plan were preserved. No files were staged.

## Only proposed next step

Run **one free technical experiment only**: an isolated local OpenCV Telea inpaint proof on three representative confirmed masks (one cosmic, Porsche 01, Nature 01), with the same exact strings and the same outside-mask byte comparison. It must reach at least 80% pass on those three without ghost text or compositional damage before any paid image benchmark, production routing, or Plan 03 is considered.

`paid calls: 0`
`commit/deploy: нет`

---

## 2026-09-14 — network-enabled isolated OpenCV Telea rerun (STOP)

**Verdict: RECONSTRUCTION NO-GO (0/3).** This is a rerun only for the agreed
three fixtures: `solar-01`, `porsche-01`, and `nature-01`. It did not modify
production code, `package.json`, lockfiles, provider routing, or Plan 03; it
did not call a paid API, create a commit, or deploy.

### Isolated local runtime

The only direct package installed into the local virtual environment is the
binary wheel `opencv-python-headless==5.0.0.93`; `numpy==2.5.3` is its required
transitive runtime dependency. The environment is isolated at
`D:\presentation\.codex-artifacts\image-first-editable-slides-v1\telea-remediation\venv`.

| Command | Result |
|---|---|
| `py -3.13 -m venv .codex-artifacts\image-first-editable-slides-v1\telea-remediation\venv` | created local Python 3.13 venv |
| `venv\Scripts\python.exe -m pip install --only-binary=:all: opencv-python-headless` | installed `opencv-python-headless 5.0.0.93` and required `numpy 2.5.3` from binary wheels |
| `venv\Scripts\python.exe -c "import cv2; print(cv2.__version__); print(cv2.INPAINT_TELEA)"` | `import cv2: OK`; `5.0.0`; `1` |
| `venv\Scripts\python.exe run_telea.py` | Telea (`radius=3`) ran offline on the three exact existing source/mask pairs |
| `node render_native_and_side_by_side.mjs` | rendered native-text and evidence montages locally with the existing project renderer dependency |

Cost: **0 paid API calls, 0 provider/image/search calls, 0 RUB**. The only
network activity was the one requested PyPI binary-wheel download into this
isolated venv.

### Exact-mask and native-string evidence

The source and mask copies retain the preflight SHA-256 values; native strings
are the existing pinned NFC-normalized canvas strings (not OCR output). The
Telea operation was constrained to the binary exact mask. Byte comparison of
the complete RGB image outside that mask yields **0 changed pixels** in every
case; the black `pixel-diff-outside-mask.png` files are the visual proof.

| Fixture | Exact source SHA-256 | Exact mask SHA-256 | Native strings | Outside-mask changed px | Old text gone | Composition intact | Result |
|---|---|---|---:|---:|---|---|---|
| solar-01 | `0a64b464a7f42ab31951f251760fc2ddcae1920b81bffc0e91d16b2383b58beb` | `46f8a0c4df05c238f3b0e700a300e96ca837a2082fb0f943472943d7afab3d60` | 16/16 NFC | 0 | **No** — readable residual letterforms remain in title/card/timeline areas | **No** — cards and timeline become dark/blurred blocks | FAIL |
| porsche-01 | `052d1538dc54bbecf9a928916a71a61062cd5e29eb0ccd5b31893a5de676b67f` | `c60d09cfd3a4516f4db6b8af1ba6d7b57c334f8183624f5aadd36d130bd1f01f` | 4/4 NFC | 0 | **No** — `Porsche 911` remains readable | **No** — broad dark smear crosses the car/landscape title region | FAIL |
| nature-01 | `935ad48317215723b6d55c9d48614f8fa8780df4937b0ba4044cf292232092b1` | `8ca44f2872db98b3ea9767c34cf69984a6246cc1cc4d5f43423b39db7227ae3d` | 12/12 NFC | 0 | **No** — heading residual including `Ростовской области` remains readable | **No** — cards plus map/landscape acquire pale vertical/block artifacts | FAIL |

For each fixture, the artifact directory contains the required original,
exact mask, Telea-cleaned image, outside-mask pixel diff, ghost-text evidence,
native reconstruction (PNG and editable canvas JSON), fallback, and labelled
side-by-side evidence:

| Fixture | Artifact directory | Side-by-side |
|---|---|---|
| solar-01 | [all artifacts](../../../.codex-artifacts/image-first-editable-slides-v1/telea-remediation/solar-01/) | [side-by-side.png](../../../.codex-artifacts/image-first-editable-slides-v1/telea-remediation/solar-01/side-by-side.png) |
| porsche-01 | [all artifacts](../../../.codex-artifacts/image-first-editable-slides-v1/telea-remediation/porsche-01/) | [side-by-side.png](../../../.codex-artifacts/image-first-editable-slides-v1/telea-remediation/porsche-01/side-by-side.png) |
| nature-01 | [all artifacts](../../../.codex-artifacts/image-first-editable-slides-v1/telea-remediation/nature-01/) | [side-by-side.png](../../../.codex-artifacts/image-first-editable-slides-v1/telea-remediation/nature-01/side-by-side.png) |

The machine-readable measurement and exact artifact paths are in
[telea-remediation/summary.json](../../../.codex-artifacts/image-first-editable-slides-v1/telea-remediation/summary.json).
`ghost-text-evidence.png` is a mask-constrained residual visualization, not a
claim that OpenCV performs OCR; the visible remnants were reviewed directly in
the labelled montages.

### Strict acceptance and STOP

The required rule is **3/3**: no old text, no compositional damage, and no
outside-mask change. The third condition passes **3/3**, but the first two
fail **3/3**. Therefore the result remains **RECONSTRUCTION NO-GO**. Stop:
do not begin Plan 03 or any paid benchmark, production routing, commit, or
deploy from this result.

`paid calls: 0`
`commit/deploy: нет`

---

## 2026-09-14 — isolated OpenCV Telea remediation preflight (STOP)

**Verdict: RECONSTRUCTION NO-GO**

This is the one requested free remediation experiment scope: `solar-01`,
`porsche-01`, and `nature-01` only. It did not enter Plan 03, production
routing, or any provider flow. No network, OCR/vision API, GPT Image, Luna,
Tavily, commit, or deploy was used.

The required local engine is unavailable on this host. The explicitly provided
bundled offline Python runtime was also checked; it starts successfully but has
no `cv2` module or `cv2.INPAINT_TELEA` constant. Both installed local
interpreters fail `import cv2` as well:

| Local command | Result |
|---|---|
| `C:\\Users\\Борис.BORIS\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe -c "import cv2"` | `ModuleNotFoundError: No module named 'cv2'`; `find_spec('cv2')` is `None` |
| `py -3 -c "import cv2; print(cv2.__version__)"` | `ModuleNotFoundError: No module named 'cv2'` |
| `py -3.8 -c "import cv2; print(cv2.__version__)"` | `ModuleNotFoundError: No module named 'cv2'` |
| repository dependency search | no OpenCV package or bundled `cv2` was found |

Installing OpenCV would require introducing a new dependency (and normally a
network fetch), which is outside this no-network proof. A blur or another
non-OpenCV substitute would not be a Telea result, so it was not run.

### Telea acceptance evidence

No Telea output exists, therefore none of the three fixtures can satisfy the
strict 3/3 PASS rule. The explicit preflight artifact is
[preflight.json](../../../.codex-artifacts/image-first-editable-slides-v1/telea-remediation/preflight.json).
For each of `solar-01`, `porsche-01`, and `nature-01`, it records the absence
of a Telea-produced original copy, exact planned mask, cleaned image, pixel
diff, ghost-text evidence, native reconstruction, fallback, and side-by-side.
The prior blur-baseline artifacts remain historical evidence only; their gold
/ planned masks are not presented as automatic production OCR evidence and
are not relabelled as this Telea proof.

Exact semantic strings already remain NFC-normalized and editable in the
earlier canonical native canvases, but this does not prove a clean Telea
reconstruction and is not counted as a pass.

### STOP

`0/3` pass. Do not proceed to Plan 03, a paid image benchmark, or production
routing. The sole next action, if separately authorized, is to make a local
OpenCV runtime available offline and rerun this same three-fixture proof with
all eight required artifacts and the outside-expanded-mask byte comparison.

### Historical 2026-09-14 21:08 MSK verification

This earlier no-runtime check predates and is superseded by the
network-enabled isolated OpenCV run above. Its `preflight.json` remains an
accurate record that no Telea artifact existed **at that time**; the current
controlling evidence is `telea-remediation/summary.json`, which records the
executed OpenCV 5.0.0 proof and its quality-based **RECONSTRUCTION NO-GO**.

## Current controlling result

**RECONSTRUCTION NO-GO (0/3).** The network-enabled Telea run is the current
evidence: it preserves all pixels outside the exact masks, but leaves readable
old-text residuals and damages composition on each fixture. Do not start Plan
03, a paid benchmark, production routing, commit, or deploy.
