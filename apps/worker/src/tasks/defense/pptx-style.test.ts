import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractDefensePptxStyle } from "./pptx-style.js";

describe("defense PPTX style extraction", () => {
  it("extracts theme colors and fonts without copying layouts", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types />");
    zip.file("ppt/presentation.xml", "<p:presentation xmlns:p='p' />");
    zip.file("ppt/theme/theme1.xml", `
      <a:theme xmlns:a="a"><a:themeElements><a:clrScheme>
        <a:dk1><a:srgbClr val="24170B" /></a:dk1>
        <a:lt1><a:srgbClr val="FFF5E9" /></a:lt1>
        <a:accent1><a:srgbClr val="FF8A00" /></a:accent1>
      </a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Nunito" /></a:majorFont>
      <a:minorFont><a:latin typeface="Arial" /></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const result = await extractDefensePptxStyle(buffer);
    expect(result.palette).toEqual(["#24170B", "#FFF5E9", "#FF8A00"]);
    expect(result.headingFont).toBe("Nunito");
    expect(result.bodyFont).toBe("Arial");
    expect(result.logoCandidates).toEqual([]);
  });

  it("rejects entity declarations", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<p:presentation />");
    zip.file("ppt/theme/theme1.xml", "<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///secret'>]><a:theme />");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(extractDefensePptxStyle(buffer)).rejects.toThrow(/declarations are not allowed/i);
  });
});
