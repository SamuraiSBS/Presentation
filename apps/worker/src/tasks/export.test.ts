import { existsSync } from "node:fs";
import JSZip from "jszip";
import { PREMIUM_PRESENTATION_THEMES, PREMIUM_PRESENTATION_THEME_IDS } from "@studydeck/shared";
import { describe, expect, it } from "vitest";
import { createPdf, createPptx } from "./export.js";

describe("createPptx", () => {
  it("creates a wide deck without visible source text", async () => {
    const buffer = await createPptx({
      id: "presentation-1",
      title: "Русское кино после 2010 года",
      scenario: "school_report",
      level: "8-11 класс",
      slideCount: 1,
      generationMode: "demo",
      generatedText: "Слайд 1: Русское кино после 2010 года\nПосле 2010 года российское кино стало заметнее работать с жанрами.",
      sources: [
        {
          id: "src-1",
          label: "Источник о кино",
          type: "WEB",
          size: 0,
          excerpt: "Фактологический материал.",
        },
      ],
      outline: ["Русское кино после 2010 года"],
      narrativePlan: [],
      presentationTheme: {
        preset: "tech",
        mood: "neutral",
        colors: {
          background: "#101820",
          surface: "#172331",
          surfaceAlt: "#20364A",
          text: "#F1F7FB",
          muted: "#B8CAD8",
          accent: "#38BDF8",
          accentAlt: "#A3E635",
          line: "#315064",
        },
        fonts: {
          heading: "Aptos Display",
          body: "Aptos",
          tone: "technical",
        },
      },
      speechScript: [
        {
          slideOrder: 1,
          slideTitle: "Русское кино после 2010 года",
          text: "После 2010 года российское кино стало заметнее работать с жанрами, онлайн-платформами и фестивальным прокатом.",
        },
      ],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Русское кино после 2010 года",
          slideKind: "content",
          layout: "hero",
          thesis: "После 2010 года российское кино стало заметнее работать с жанрами.",
          bullets: ["Появились онлайн-премьеры", "Фестивальные драмы остались важными", "Франшизы расширили аудиторию"],
          definition: { term: "Франшиза", text: "Серия связанных фильмов с общей идеей или героями." },
          keyConcepts: [{ label: "Жанры", icon: "idea" }],
          visual: {
            type: "timeline",
            title: "Изменения",
            description: "",
            leftLabel: "",
            rightLabel: "",
            items: [{ label: "2010-е", text: "Рост разных форматов" }],
            rows: [],
          },
          highlights: [{ text: "онлайн-премьеры", tone: "accent" }],
          blocks: [
            {
              type: "callout",
              content: "После 2010 года российское кино стало активнее развиваться в жанровом и авторском направлениях.",
            },
          ],
          speakerNotes:
            "Расскажите, как менялись жанры, прокат и зрительское внимание к российскому кино после 2010 года.",
          timingSeconds: 45,
          sourceRefs: [{ sourceId: "src-1", label: "Источник о кино", excerpt: "Фактологический материал.", page: null }],
        },
      ],
    });

    const zip = await JSZip.loadAsync(buffer);
    const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
    const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");

    expect(slideXml).toContain("101820");
    expect(slideXml).toContain("F1F7FB");
    expect(presentationXml).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    expect(slideXml).toContain("Русское кино после 2010 года");
    expect(slideXml).toContain("После 2010 года российское кино");
    expect(slideXml).toContain("онлайн-премьеры");
    expect(slideXml).toContain("Франшиза");
    expect(slideXml).toContain("Изменения");
    expect(slideXml).not.toContain("Источник");
  });

  it("creates a pptx when slide image metadata has no cached object", async () => {
    const buffer = await createPptx({
      id: "presentation-1",
      title: "Image metadata deck",
      scenario: "lesson",
      level: "beginner",
      slideCount: 1,
      generationMode: "demo",
      generatedText: "Слайд 1: Image metadata\nThe slide remains exportable even before an image is cached.",
      sources: [],
      outline: ["Image metadata"],
      narrativePlan: [],
      speechScript: [{ slideOrder: 1, slideTitle: "Image metadata", text: "Narration." }],
      slides: [
        {
          id: "slide-1",
          order: 1,
          title: "Image metadata",
          slideKind: "content",
          layout: "bullets",
          thesis: "The slide remains exportable even before an image is cached.",
          bullets: ["Metadata is optional", "Export falls back to text", "The deck stays valid"],
          definition: null,
          keyConcepts: [],
          visual: {
            type: "image",
            title: "Visual example",
            description: "A classroom",
            leftLabel: "",
            rightLabel: "",
            items: [],
            rows: [],
            image: {
              url: "https://cdn.example.com/classroom.jpg",
              alt: "A classroom",
              query: "classroom",
              sourceTitle: "Example",
              provider: "tavily",
              contentType: "image/jpeg",
            },
          },
          highlights: [],
          blocks: [{ type: "bullets", items: ["Metadata is optional", "Export falls back to text", "The deck stays valid"] }],
          speakerNotes: "Narration.",
          timingSeconds: 45,
          sourceRefs: [],
        },
      ],
    });

    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");

    expect(slideXml).toContain("Image metadata");
    expect(slideXml).toContain("The slide remains exportable");
  });

  it("renders editable canvas text and shapes to pptx", async () => {
    const buffer = await createPptx(canvasDeck());
    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");

    expect(slideXml).toContain("Canvas title");
    expect(slideXml).toContain("Canvas body");
    expect(slideXml).toContain("FF8A00");
    expect(slideXml).toContain("161A1F");
  });

  it("exports evidence sources compactly without breaking pptx", async () => {
    const source = canvasDeck();
    const evidenceSlide = {
      ...source.slides[0],
      layout: "evidence" as const,
      canvas: undefined,
      thesis: "The claim is supported by two concrete observations.",
      bullets: ["Observation one supports the claim", "Observation two confirms the pattern"],
      sourceRefs: [{ sourceId: "source-1", label: "Research notes", excerpt: "A compact supporting excerpt that remains readable.", page: "p. 4" }],
    };
    const buffer = await createPptx({ ...source, slides: [evidenceSlide] });
    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");

    expect(slideXml).toContain("The claim is supported");
    expect(slideXml).toContain("Research notes");
    expect(slideXml).toContain("p. 4");
  });

  it("exports every premium presentation theme", async () => {
    for (const themeId of PREMIUM_PRESENTATION_THEME_IDS) {
      const theme = PREMIUM_PRESENTATION_THEMES[themeId];
      const source = canvasDeck();
      const slides = source.slides.map(({ canvas: _canvas, ...slide }) => slide);
      const buffer = await createPptx({ ...source, presentationTheme: theme, slides });
      const zip = await JSZip.loadAsync(buffer);
      const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");

      expect(slideXml, themeId).toContain(theme.colors.background.slice(1));
      expect(slideXml, themeId).toContain(theme.colors.text.slice(1));
    }
  });

  it.skipIf(!hasChromium())("renders editable canvas to a real pdf", async () => {
    const buffer = await createPdf(canvasDeck());

    expect(buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});

function canvasDeck() {
  return {
    id: "presentation-canvas",
    title: "Canvas deck",
    scenario: "lesson",
    level: "beginner",
    slideCount: 1,
    generationMode: "demo" as const,
    generatedText: "Slide 1: Canvas title\nCanvas body.",
    sources: [],
    outline: ["Canvas title"],
    narrativePlan: [],
    speechScript: [{ slideOrder: 1, slideTitle: "Canvas title", text: "Narration." }],
    slides: [
      {
        id: "slide-1",
        order: 1,
        title: "Canvas title",
        slideKind: "content" as const,
        layout: "bullets" as const,
        thesis: "Canvas body.",
        bullets: [],
        definition: null,
        keyConcepts: [],
        visual: { type: "none" as const, title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] },
        highlights: [],
        blocks: [{ type: "callout" as const, content: "Canvas body." }],
        canvas: {
          width: 1280,
          height: 720,
          background: "#FFFFFF",
          elements: [
            {
              id: "shape-1",
              type: "shape" as const,
              shape: "roundRect" as const,
              x: 80,
              y: 90,
              w: 1120,
              h: 500,
              rotation: 0,
              zIndex: 1,
              opacity: 1,
              locked: false,
              fill: "#FF8A00",
              stroke: "#161A1F",
              strokeWidth: 2,
            },
            {
              id: "text-1",
              type: "text" as const,
              role: "title" as const,
              x: 150,
              y: 160,
              w: 980,
              h: 120,
              rotation: 0,
              zIndex: 2,
              opacity: 1,
              locked: false,
              text: "Canvas title",
              runs: [{ text: "Canvas title", bold: true }],
              fontSize: 46,
              fontFamily: "Arial",
              color: "#161A1F",
              bold: true,
              italic: false,
              underline: false,
              align: "center" as const,
              valign: "middle" as const,
            },
            {
              id: "text-2",
              type: "text" as const,
              role: "body" as const,
              x: 220,
              y: 310,
              w: 840,
              h: 120,
              rotation: 0,
              zIndex: 3,
              opacity: 1,
              locked: false,
              text: "Canvas body",
              runs: [{ text: "Canvas body", italic: true }],
              fontSize: 30,
              fontFamily: "Arial",
              color: "#161A1F",
              bold: false,
              italic: true,
              underline: false,
              align: "center" as const,
              valign: "middle" as const,
            },
          ],
        },
        speakerNotes: "Narration.",
        timingSeconds: 45,
        sourceRefs: [],
      },
    ],
  };
}

function hasChromium() {
  return [
    process.env.CHROMIUM_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
  ]
    .filter(Boolean)
    .some((candidate) => existsSync(candidate as string));
}
