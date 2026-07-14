import { describe, expect, it } from "vitest";
import { ACTIVE_PROJECT_STATUSES } from "./dashboard.service.js";

describe("dashboard active project statuses", () => {
  it("polls only projects that can still make progress", () => {
    expect(ACTIVE_PROJECT_STATUSES).toEqual([
      "uploading",
      "script_queued",
      "script_generating",
      "queued",
      "generating",
    ]);
    expect(ACTIVE_PROJECT_STATUSES).not.toContain("failed");
  });
});
