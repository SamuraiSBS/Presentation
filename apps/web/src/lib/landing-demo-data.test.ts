import { describe, expect, it } from "vitest";
import { presentationSchema } from "@studydeck/shared";
import { LANDING_SHOWCASE_FIXTURES } from "./landing-demo-data";

describe("landing showcase fixtures", () => {
  it("keeps every showcase compatible with the presentation renderer contract", () => {
    expect(LANDING_SHOWCASE_FIXTURES).toHaveLength(3);

    for (const fixture of LANDING_SHOWCASE_FIXTURES) {
      expect(presentationSchema.parse(fixture.presentation).slides).toHaveLength(4);
      expect(fixture.presentation.speechScript).toHaveLength(4);
      expect(fixture.cover.src).toMatch(/^\/landing\//);
      expect(fixture.cover.alt).not.toHaveLength(0);
    }
  });
});
