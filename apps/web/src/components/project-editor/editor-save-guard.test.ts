import { describe, expect, it, vi } from "vitest";
import {
  createUnsavedChangesBeforeUnloadHandler,
  type BeforeUnloadLikeEvent,
} from "./editor-save-guard";

describe("createUnsavedChangesBeforeUnloadHandler", () => {
  it("does not interrupt page close or navigation when all edits are saved", () => {
    const preventDefault = vi.fn();
    const event: BeforeUnloadLikeEvent = { preventDefault };

    createUnsavedChangesBeforeUnloadHandler(() => false)(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(event.returnValue).toBeUndefined();
  });

  it("interrupts page close or navigation while an edit is pending", () => {
    const preventDefault = vi.fn();
    const event: BeforeUnloadLikeEvent = { preventDefault };

    createUnsavedChangesBeforeUnloadHandler(() => true)(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
  });
});
