import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  extractDefenseArchiveDocuments,
  isDefenseDocumentationPath,
  isSafeArchivePath,
} from "./archive.js";

describe("defense ZIP ingestion", () => {
  it("accepts only README and explicit documentation paths", () => {
    expect(isDefenseDocumentationPath("README.md")).toBe(true);
    expect(isDefenseDocumentationPath("docs/architecture.md")).toBe(true);
    expect(isDefenseDocumentationPath("documentation/spec.pdf")).toBe(true);
    expect(isDefenseDocumentationPath("src/index.ts")).toBe(false);
    expect(isDefenseDocumentationPath("node_modules/pkg/README.md")).toBe(false);
  });

  it("rejects traversal and absolute entry paths", () => {
    expect(isSafeArchivePath("docs/brief.md")).toBe(true);
    expect(isSafeArchivePath("../secret.md")).toBe(false);
    expect(isSafeArchivePath("docs/../secret.md")).toBe(false);
    expect(isSafeArchivePath("C:/secret.md")).toBe(false);
    expect(isSafeArchivePath("/secret.md")).toBe(false);
  });

  it("extracts documentation without materializing source code", async () => {
    const zip = new JSZip();
    zip.file("README.md", "Project facts");
    zip.file("docs/architecture.txt", "Architecture facts");
    zip.file("src/index.ts", "throw new Error('must not be read')");
    const archive = await zip.generateAsync({ type: "nodebuffer" });
    const documents = await extractDefenseArchiveDocuments(archive);

    expect(documents.map((item) => item.path)).toEqual(["README.md", "docs/architecture.txt"]);
    expect(documents.map((item) => item.buffer.toString("utf8"))).toEqual(["Project facts", "Architecture facts"]);
  });

  it("enforces uncompressed documentation limits", async () => {
    const zip = new JSZip();
    zip.file("README.md", "x".repeat(128));
    const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await expect(extractDefenseArchiveDocuments(archive, { maxEntryBytes: 64 })).rejects.toThrow(/size limit/i);
  });
});
