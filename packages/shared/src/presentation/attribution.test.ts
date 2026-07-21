import { describe, expect, it } from "vitest";
import {
  formatImageAttribution,
  formatSlideAttribution,
  normalizeSourceRefs,
} from "./attribution.js";

describe("presentation attribution", () => {
  const sources = [
    { id: "upload", label: "lecture-notes.pdf", type: "FILE", excerpt: "Uploaded lecture notes." },
    { id: "web", label: "Research archive", type: "WEB", excerpt: "Verified historical background.", url: "https://example.org/research?long=query" },
  ];

  it("removes invalid and duplicate references while preserving uploaded sources", () => {
    const refs = normalizeSourceRefs([
      { sourceId: "missing", label: "Missing", excerpt: "", page: null },
      { sourceId: "upload", label: "", excerpt: "", page: null },
      { sourceId: "upload", label: "Duplicate", excerpt: "", page: null },
      { sourceId: "web", label: "", excerpt: "", page: "p. 4" },
    ], sources);

    expect(refs).toEqual([
      expect.objectContaining({ sourceId: "upload", label: "lecture-notes.pdf" }),
      expect.objectContaining({ sourceId: "web", label: "Research archive", page: "p. 4" }),
    ]);
  });

  it("formats compact source and image credits without leaking long URLs", () => {
    const credit = formatSlideAttribution([
      { sourceId: "upload", label: "lecture-notes.pdf", excerpt: "", page: null },
      { sourceId: "web", label: "Research archive", excerpt: "", page: null },
    ], {
      url: "https://cdn.example.org/photo.jpg",
      alt: "Historic photograph",
      query: "historic photograph",
      sourceUrl: "https://images.example.org/photos/archive?tracking=very-long-value",
      sourceTitle: "Archive photograph collection",
      provider: "tavily",
      contentType: "image/jpeg",
      warnings: [],
    });

    expect(credit).toBe("Источники: [1] lecture-notes.pdf [2] Research archive · Фото: Archive photograph collection");
    expect(credit).not.toContain("tracking=");
    expect(formatImageAttribution({
      url: "https://local.example/image.jpg", alt: "", query: "", sourceTitle: "", provider: "user", contentType: "image/jpeg", warnings: [],
    })).toBe("Источник: материалы пользователя");
  });
});
