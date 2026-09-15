import { afterEach, describe, expect, it, vi } from "vitest";
import { imageFirstEditableInitialCostPolicy } from "@studydeck/shared";

const { findUniqueOrThrow, reserveCostEnvelope } = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  reserveCostEnvelope: vi.fn(),
}));

vi.mock("../../../prisma.js", () => ({
  getPrisma: () => ({ costEnvelope: { findUniqueOrThrow } }),
}));
vi.mock("../../../cost-envelope.js", () => ({
  createCostEnvelopeWithPolicy: vi.fn(),
  reserveCostEnvelope,
}));

import { reserveImageFirstEditableInitialStage } from "./economics.js";

const envelopeId = "ife1-initial-envelope";

afterEach(() => vi.clearAllMocks());

function useInitialPolicy(count: 6 | 8 | 10 | 12 | 14 = 6) {
  findUniqueOrThrow.mockResolvedValue({ policySnapshot: imageFirstEditableInitialCostPolicy(count) });
  reserveCostEnvelope.mockResolvedValue({ status: "reserved", idempotent: false, reservation: { id: "reservation" } });
}

describe("image_first_editable_v1 reserve wrapper", () => {
  it("reserves each non-image stage using its exact immutable policy amount", async () => {
    useInitialPolicy();
    await reserveImageFirstEditableInitialStage({ envelopeId, stage: "source_search" });
    await reserveImageFirstEditableInitialStage({ envelopeId, stage: "narration" });
    await reserveImageFirstEditableInitialStage({ envelopeId, stage: "deck_content_lock" });

    expect(reserveCostEnvelope).toHaveBeenNthCalledWith(1, expect.objectContaining({
      envelopeId, bucket: "source_search", stage: "image_first_editable_v1:source_search", amountRub: "0.20000000", idempotencyKey: `${envelopeId}:image_first_editable_v1:source_search`,
    }));
    expect(reserveCostEnvelope).toHaveBeenNthCalledWith(2, expect.objectContaining({
      envelopeId, bucket: "narration", stage: "image_first_editable_v1:narration", amountRub: "0.20000000", idempotencyKey: `${envelopeId}:image_first_editable_v1:narration`,
    }));
    expect(reserveCostEnvelope).toHaveBeenNthCalledWith(3, expect.objectContaining({
      envelopeId, bucket: "deck_content_lock", stage: "image_first_editable_v1:deck_content_lock", amountRub: "0.60000000", idempotencyKey: `${envelopeId}:image_first_editable_v1:deck_content_lock`,
    }));
  });

  it("uses one stable reservation key per image slide", async () => {
    useInitialPolicy(8);
    await reserveImageFirstEditableInitialStage({ envelopeId, stage: "image", slideOrder: 3 });
    expect(reserveCostEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      bucket: "images", stage: "image_first_editable_v1:image:3", amountRub: "1.00000000", idempotencyKey: `${envelopeId}:image_first_editable_v1:image:3`,
    }));
    await expect(reserveImageFirstEditableInitialStage({ envelopeId, stage: "image", slideOrder: 9 })).rejects.toThrow("image_first_editable_v1_image_slide_order_invalid");
  });

  it("blocks a replayed stage reservation before any automatic paid retry", async () => {
    findUniqueOrThrow.mockResolvedValue({ policySnapshot: imageFirstEditableInitialCostPolicy(6) });
    reserveCostEnvelope.mockResolvedValue({ status: "reserved", idempotent: true, reservation: { id: "existing" } });

    await expect(reserveImageFirstEditableInitialStage({ envelopeId, stage: "deck_content_lock" }))
      .resolves.toEqual({ status: "blocked", reason: "stage_already_reserved" });
    expect(reserveCostEnvelope).toHaveBeenCalledTimes(1);
  });
});
