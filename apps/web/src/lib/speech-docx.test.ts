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
    const styles = await zip.file("word/styles.xml")?.async("string");
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(document).toContain('w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"');
    expect(styles).toContain('w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"');
    expect(styles).not.toContain("Nunito");
    expect(document).toContain("Тема &amp; контекст");
    expect(document).toContain("Слайд 2. Вывод");
  });
});
