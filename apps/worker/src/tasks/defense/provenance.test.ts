import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { chunkPlainText, extractSourceWithProvenance } from "./provenance.js";

describe("defense source provenance", () => {
  it("keeps stable paragraph locators", () => {
    const chunks = chunkPlainText("source-1", "Первый абзац.\n\nВторой абзац.", 20);
    expect(chunks).toMatchObject([
      { sourceId: "source-1", locator: "абзац 1", text: "Первый абзац." },
      { sourceId: "source-1", locator: "абзац 2", text: "Второй абзац." },
    ]);
  });

  it("uses slide locators for PPTX evidence", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide2.xml", '<p:sld xmlns:p="p" xmlns:a="a"><a:t>Второй экран</a:t></p:sld>');
    zip.file("ppt/slides/slide1.xml", '<p:sld xmlns:p="p" xmlns:a="a"><a:t>Первый экран</a:t></p:sld>');
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const result = await extractSourceWithProvenance({ sourceId: "source-1", label: "reference.pptx", buffer });
    expect(result.chunks.map((item) => item.locator)).toEqual(["слайд 1", "слайд 2"]);
    expect(result.chunks[0].text).toBe("Первый экран");
  });
});
