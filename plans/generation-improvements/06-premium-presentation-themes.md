# Plan 06: Premium presentation themes

## Goal

Add 5-7 high-quality built-in visual themes that make generated presentations feel less generic and more intentionally designed.

This plan implements "Я бы добавил 5-7 готовых премиум-тем".

## Current project context

- Current `presentationThemePresetSchema` supports:
  - `moody`
  - `bright`
  - `academic`
  - `tech`
  - `nature`
  - `history`
  - `minimal`
- Theme values are resolved in `packages/shared/src/index.ts`.
- Slide rendering/export must remain compatible with existing presentations.

## Recommended themes

Implement these seven theme IDs:

1. `editorialMagazine`
2. `academicClean`
3. `darkLecture`
4. `timelineDocumentary`
5. `scienceBoard`
6. `startupPitch`
7. `softClassroom`

Keep old presets working. Either map old presets to new themes internally or extend the schema while preserving old enum values.

## Theme 1: Editorial Magazine

Best for:

- literature;
- culture;
- social topics;
- biographies;
- broad essays.

Visual traits:

- large titles;
- photo-led slides;
- strong title/content contrast;
- editorial captions;
- lots of whitespace.

Palette:

- background: `#F7F3EC`
- surface: `#FFFFFF`
- surfaceAlt: `#EFE7DA`
- text: `#171412`
- muted: `#6E6258`
- accent: `#C24E2C`
- accentAlt: `#1F5B68`
- line: `#DED2C4`

Fonts:

- heading: serif or bookish system fallback;
- body: clean sans;
- tone: `bookish`.

## Theme 2: Academic Clean

Best for:

- school reports;
- university explanations;
- exams;
- source-based material.

Visual traits:

- light background;
- strict grids;
- calm blue/green accents;
- readable notes;
- restrained cards.

Palette:

- background: `#F6F8FB`
- surface: `#FFFFFF`
- surfaceAlt: `#EAF0F6`
- text: `#172033`
- muted: `#667085`
- accent: `#2F6BFF`
- accentAlt: `#1B9A77`
- line: `#D9E2EC`

Fonts:

- heading: sans;
- body: sans;
- tone: `strict`.

## Theme 3: Dark Lecture

Best for:

- technology;
- physics;
- history with drama;
- serious analytical topics.

Visual traits:

- dark background;
- glowing but controlled accent;
- large statements;
- diagrams with high contrast;
- good for projector mode.

Palette:

- background: `#101318`
- surface: `#181D24`
- surfaceAlt: `#202733`
- text: `#F3F6FA`
- muted: `#9AA7B7`
- accent: `#FFB020`
- accentAlt: `#4DA3FF`
- line: `#303846`

Fonts:

- heading: sans;
- body: sans;
- tone: `technical`.

## Theme 4: Timeline Documentary

Best for:

- history;
- biographies;
- politics;
- events over time.

Visual traits:

- date markers;
- documentary/photo archive feel;
- muted paper tones;
- strong timelines;
- quote and evidence slides.

Palette:

- background: `#F4EFE6`
- surface: `#FFFDF8`
- surfaceAlt: `#E7DDCC`
- text: `#1F1A14`
- muted: `#756B5D`
- accent: `#8D3B2F`
- accentAlt: `#2E5E73`
- line: `#D5C7B3`

Fonts:

- heading: serif/bookish;
- body: sans;
- tone: `bookish`.

## Theme 5: Science Board

Best for:

- biology;
- chemistry;
- physics;
- medicine;
- ecology.

Visual traits:

- clear labels;
- diagram-friendly;
- scientific cards;
- subtle grid lines;
- cool palette.

Palette:

- background: `#F3FAF8`
- surface: `#FFFFFF`
- surfaceAlt: `#E4F2EF`
- text: `#10201D`
- muted: `#58706B`
- accent: `#0E9F87`
- accentAlt: `#4C6FFF`
- line: `#CFE2DE`

Fonts:

- heading: sans;
- body: sans;
- tone: `technical`.

## Theme 6: Startup Pitch

Best for:

- business;
- product;
- economics;
- project defense;
- metrics-heavy topics.

Visual traits:

- bold statements;
- metrics;
- problem/solution frames;
- high contrast;
- confident accents.

Palette:

- background: `#F8FAFC`
- surface: `#FFFFFF`
- surfaceAlt: `#EEF2FF`
- text: `#111827`
- muted: `#64748B`
- accent: `#2563EB`
- accentAlt: `#F97316`
- line: `#D8DEE9`

Fonts:

- heading: sans;
- body: sans;
- tone: `strict`.

## Theme 7: Soft Classroom

Best for:

- younger audience;
- simple school presentations;
- friendly explanations;
- literature and social topics for school.

Visual traits:

- warm but not childish;
- soft cards;
- rounded accents;
- readable type;
- gentle illustration support.

Palette:

- background: `#FFF8EF`
- surface: `#FFFFFF`
- surfaceAlt: `#FCEBD8`
- text: `#241A12`
- muted: `#7C6858`
- accent: `#F28C38`
- accentAlt: `#5B8DEF`
- line: `#EAD8C3`

Fonts:

- heading: rounded sans;
- body: sans;
- tone: `rounded`.

## Implementation steps

1. Extend theme schema safely.

In `packages/shared/src/index.ts`, either:

- add new values to `presentationThemePresetSchema`; or
- add `themeId` separately while keeping `preset` backwards-compatible.

Recommended:

```ts
themeId: z.string().optional()
```

This avoids breaking existing enum assumptions.

2. Add theme registry.

Create:

```ts
export const PREMIUM_PRESENTATION_THEMES = {
  editorialMagazine: { ... },
  academicClean: { ... },
  darkLecture: { ... },
  timelineDocumentary: { ... },
  scienceBoard: { ... },
  startupPitch: { ... },
  softClassroom: { ... },
} as const;
```

3. Add resolver.

```ts
export function resolvePremiumPresentationTheme(themeId: string | undefined, fallback: PresentationTheme): PresentationTheme
```

4. Update generation prompt.

In `buildGenerationPrompt(...)`, tell the model to choose from the supported premium theme IDs when creating a design brief.

5. Update renderer.

Use theme colors consistently in:

- canvas backgrounds;
- cards;
- title slides;
- accent shapes;
- timelines;
- metrics.

6. Update export.

Make sure `apps/worker/src/tasks/export.ts` uses the same theme values for PPTX and PDF.

7. Optional UI later.

Add a theme picker in the editor or creation flow only after generated themes work.

## Theme selection rules

The model or deterministic mapper should choose:

- history/date-heavy topic -> `timelineDocumentary`;
- biology/chemistry/physics -> `scienceBoard`;
- business/product/economics -> `startupPitch`;
- serious tech/analysis -> `darkLecture`;
- school report with no special domain -> `academicClean`;
- creative/culture/literature -> `editorialMagazine`;
- younger or friendly explanation -> `softClassroom`.

## Tests

Add tests:

- all theme colors match `#[0-9A-F]{6}`;
- all themes parse as `presentationThemeSchema`;
- resolver returns fallback for unknown theme;
- old presentations without `themeId` still parse;
- export theme resolver supports all new themes.

## Acceptance criteria

- Generated decks can use the seven premium themes.
- Themes are deterministic and valid.
- Web preview and export use the same colors.
- Existing saved presentations do not break.
- No DB migration is required.

## Non-goals

- Do not add custom user-uploaded themes in this plan.
- Do not add font file loading unless already supported.
- Do not make the model invent arbitrary theme IDs.
