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
          layout: "hero",
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

    expect(presentationXml).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    expect(slideXml).toContain("Русское кино после 2010 года");
    expect(slideXml).not.toContain("Источник");
  });
});
