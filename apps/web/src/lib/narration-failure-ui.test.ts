import { describe, expect, it } from "vitest";
import { narrationFailureUi, narrationReviewMode } from "./narration-failure-ui.js";

describe("public narration failure UI", () => {
  it("shows a neutral saved-project message for source preparation failure", () => {
    const copy = narrationFailureUi("source_preparation_failed");

    expect(copy.title).toBe("Не удалось подготовить текст");
    expect(copy.message).toContain("Проект сохранён");
    expect(copy.message).not.toMatch(/качества|попыток|tavily|provider|\d+\s*(слов|words)/i);
  });

  it("uses the neutral fallback for malformed or unknown failures", () => {
    const copy = narrationFailureUi(undefined);

    expect(copy.message).not.toMatch(/качества|попыток|provider|\d+\s*(слов|words)/i);
  });

  it("uses presentation recovery copy when narration is already saved", () => {
    const copy = narrationFailureUi("accepted_speech", "presentation");

    expect(copy.title).toBe("Не удалось собрать презентацию");
    expect(copy.message).toContain("полную AI-пересборку презентации");
  });

  it("opens the normal editor for an editable draft without treating it as accepted", () => {
    expect(narrationReviewMode({ status: "script_ready", speechDraft: "Слайд 1: Тема", narrationState: "editable_draft" })).toBe("editor");
    expect(narrationReviewMode({ status: "script_ready", speechDraft: "Слайд 1: Тема", narrationState: "accepted_speech" })).toBe("editor");
  });

  it("keeps a no-draft failure on the failure panel", () => {
    expect(narrationReviewMode({ status: "failed", speechDraft: null, narrationState: "narration_failed" })).toBe("failure");
  });
});
