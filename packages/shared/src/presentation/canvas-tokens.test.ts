import { describe, expect, it } from "vitest";
import {
  EDITORIAL_CONTENT_WIDTH,
  EDITORIAL_GUTTER,
  EDITORIAL_MARGIN_X,
  PLAQUE_PADDING_X,
  PLAQUE_PADDING_Y,
  READABLE_BODY_FONT_SIZE,
  READABLE_PLAQUE_FONT_SIZE,
} from "./canvas-tokens.js";

describe("canvas composition tokens", () => {
  it("keeps generated text and editorial layout tokens readable and bounded", () => {
    expect(READABLE_BODY_FONT_SIZE).toBeGreaterThanOrEqual(18);
    expect(READABLE_PLAQUE_FONT_SIZE).toBeGreaterThanOrEqual(12);
    expect(EDITORIAL_MARGIN_X * 2 + EDITORIAL_CONTENT_WIDTH).toBeLessThanOrEqual(1280);
    expect(EDITORIAL_GUTTER).toBeGreaterThan(0);
    expect(PLAQUE_PADDING_X).toBeGreaterThan(0);
    expect(PLAQUE_PADDING_Y).toBeGreaterThan(0);
  });
});
