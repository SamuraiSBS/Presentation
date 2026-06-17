import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createPptx } from "./export.js";

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
});
