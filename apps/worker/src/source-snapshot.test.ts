import { describe, expect, it } from "vitest";
import { createMandatorySourceSnapshot, parseMandatorySourceSnapshot, snapshotSources } from "./source-snapshot.js";

describe("mandatory source snapshot", () => {
  it("keeps three to four bounded, reproducible web sources", () => {
    const snapshot = createMandatorySourceSnapshot([1, 2, 3, 4, 5].map((number) => ({
      id: `source-${number}`,
      label: `Source ${number}`,
      type: "WEB",
      size: 0,
      url: `https://example.edu/${number}`,
      excerpt: `Evidence ${number} `.repeat(100),
    })), new Date("2026-07-24T10:00:00.000Z"));
    expect(snapshot?.sources).toHaveLength(4);
    expect(snapshot?.sources.every((source) => source.evidenceExcerpt.length <= 320)).toBe(true);
    expect(snapshotSources(parseMandatorySourceSnapshot(snapshot)!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "source-1", type: "WEB" }),
    ]));
  });
});
