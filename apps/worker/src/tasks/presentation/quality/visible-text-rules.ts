import type { PresentationDocument, QualityIssue, Slide } from "@studydeck/shared";

/**
 * Deterministic guardrails for copy rendered directly on a slide.
 *
 * This slice deliberately has no model, repair, or persistence dependency:
 * renderer-facing limits can be changed and tested independently.
 */
export function isVisibleTextTooLong(slide: Slide) {
  const visibleText = [
    slide.title,
    slide.thesis,
    ...slide.bullets,
    ...slide.blocks.flatMap((block) => block.type === "bullets" ? block.items : [block.content]),
  ].join(" ");

  return wordCount(slide.title) > 12
    || slide.title.length > 90
    || sentenceCount(slide.thesis) > 1
    || wordCount(slide.thesis) > 28
    || slide.thesis.length > 220
    || wordCount(visibleText) > 78
    || sentenceCount(visibleText) > 7
    || slide.bullets.some((bullet) => wordCount(bullet) > 18 || bullet.length > 130)
    || slide.blocks.some((block) => {
      const values = block.type === "bullets" ? block.items : [block.content];
      return values.some((value) => wordCount(value) > 22 || value.length > 160);
    });
}

export function findLongSlideTextIssues(presentation: PresentationDocument): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const slide of presentation.slides) {
    if (!isVisibleTextTooLong(slide)) continue;
    if (wordCount(slide.title) > 12 || slide.title.length > 90) {
      issues.push(longIssue(slide, "title", "Slide title is too long."));
    }
    if (sentenceCount(slide.thesis) > 1 || wordCount(slide.thesis) > 28 || slide.thesis.length > 220) {
      issues.push(longIssue(slide, "thesis", "Slide thesis must be one compact sentence."));
    }
    slide.bullets.forEach((bullet, index) => {
      if (wordCount(bullet) > 18 || bullet.length > 130) {
        issues.push(longIssue(slide, `bullets.${index}`, "Bullet is too long for slide text."));
      }
    });
    slide.blocks.forEach((block, index) => {
      const values = block.type === "bullets" ? block.items : [block.content];
      values.forEach((value, itemIndex) => {
        if (wordCount(value) > 22 || value.length > 160) {
          issues.push(longIssue(
            slide,
            block.type === "bullets" ? `blocks.${index}.items.${itemIndex}` : `blocks.${index}.content`,
            "Block text is too dense.",
          ));
        }
      });
    });
  }
  return issues;
}

function longIssue(slide: Slide, field: string, message: string): QualityIssue {
  return {
    slideId: slide.id,
    severity: field === "title" || field === "thesis" ? "major" : "minor",
    category: "too_long",
    field,
    message,
    repairInstruction: "Shorten this field without losing its concrete meaning.",
  };
}

function sentenceCount(value: string) {
  return cleanText(value).split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean).length;
}

function wordCount(value: string) {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}
