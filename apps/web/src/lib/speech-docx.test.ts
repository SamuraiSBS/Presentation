import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildSpeechDocx, speechPlainText } from "./speech-docx";

const speech = [
  { slideOrder: 1, slideTitle: "Введение", text: "Начинаем рассказ." },
  { slideOrder: 2, slideTitle: "Вывод", text: "Подводим итог." },
];

describe("speech DOCX export", () => {
  it("formats a copyable script slide by slide", () => {
    expect(speechPlainText("Тема", speech)).toContain("Слайд 1. Введение\n\nНачинаем рассказ.");
  });

  it("builds a DOCX package with slide headings", async () => {
    const zip = await JSZip.loadAsync(await (await buildSpeechDocx("Тема & контекст", speech)).arrayBuffer());
    const document = await zip.file("word/document.xml")?.async("string");
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(document).toContain("Тема &amp; контекст");
    expect(document).toContain("Слайд 2. Вывод");
  });
});
