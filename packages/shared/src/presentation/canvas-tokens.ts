import { presentationTypography } from "./typography.js";

/**
 * Pure canvas composition tokens. Layout builders consume these values but do
 * not own them, keeping later layout extraction free of builder cycles.
 */
export const READABLE_BODY_FONT_SIZE = presentationTypography.body.preferredPx;
export const READABLE_PLAQUE_FONT_SIZE = presentationTypography.label.preferredPx;
export const PLAQUE_PADDING_X = 18;
export const PLAQUE_PADDING_Y = 12;
export const EDITORIAL_MARGIN_X = 72;
export const EDITORIAL_CONTENT_WIDTH = 1136;
export const EDITORIAL_GUTTER = 24;
