import { describe, expect, it } from "vitest";
import { EXPORT_FONT_FAMILY, EXPORT_PDF_FONT_STACK, exportFontFamily, exportPdfFontStack } from "./font-policy.js";

describe("export font policy", () => {
  it("normalizes old theme and custom canvas fonts to the approved export family", () => {
    expect(exportFontFamily("Aptos Display")).toBe(EXPORT_FONT_FAMILY);
    expect(exportFontFamily("Georgia")).toBe(EXPORT_FONT_FAMILY);
    expect(exportFontFamily("A user supplied font")).toBe(EXPORT_FONT_FAMILY);
    expect(exportPdfFontStack("Verdana")).toBe(EXPORT_PDF_FONT_STACK);
  });
});
