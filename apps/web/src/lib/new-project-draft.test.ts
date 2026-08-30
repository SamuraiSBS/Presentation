import { describe, expect, it } from "vitest";
import {
  NEW_PROJECT_DRAFT_VERSION,
  parseNewProjectDraft,
} from "./new-project-draft";

const validDraft = {
  version: NEW_PROJECT_DRAFT_VERSION,
  step: 2,
  topic: "AI в образовании",
  slideCount: 6,
  volumeConfirmed: true,
  sourceMode: "files" as const,
  projectId: "project-1",
  idempotencyKey: "new-project-request-1",
  phase: "upload_failed" as const,
};

describe("new project draft", () => {
  it("accepts the versioned fields required to resume creation", () => {
    expect(parseNewProjectDraft(validDraft)).toEqual(validDraft);
  });

  it("rejects stale, malformed, and unsafe drafts", () => {
    expect(parseNewProjectDraft({ ...validDraft, version: 0 })).toBeNull();
    expect(parseNewProjectDraft({ ...validDraft, step: 4 })).toBeNull();
    expect(parseNewProjectDraft({ ...validDraft, sourceMode: "local" })).toBeNull();
    expect(parseNewProjectDraft({ ...validDraft, idempotencyKey: "short" })).toBeNull();
    expect(parseNewProjectDraft(null)).toBeNull();
  });
});
