import type { SlideCard, Slide, SlideLayout, SlideVisual } from "./schemas.js";
import { slideSchema, slideVisualSchema } from "./schemas.js";

/**
 * Maps the editorial composition vocabulary to the concrete layouts consumed
 * by every renderer. Keeping this mapping in shared makes a card incapable of
 * silently drifting from the canvas, web template, or export projection.
 */
export function slideLayoutForCard(card: Pick<SlideCard, "composition">, slide: Pick<Slide, "slideKind">): SlideLayout {
  if (slide.slideKind === "title") return "hero";
  if (slide.slideKind === "summary" || card.composition === "visual_conclusion") return "summary";
  switch (card.composition) {
    case "full_screen_image":
    case "image_text_column":
      return "image-focus";
    case "process":
      return "process";
    case "comparison":
      return "comparison";
    case "timeline":
      return "timeline";
    case "relationship_map":
      return "process";
    case "research_composition":
      return "evidence";
    default:
      return "bullets";
  }
}

/**
 * Compile one semantic card into the persisted Slide contract. The existing
 * slide supplies only non-semantic payload that the card does not own (for
 * example a downloaded image, source refs, timing, and placeholders).
 */
export function compileSlideCardToSlide(card: SlideCard, baseSlide: Slide): Slide {
  const visual = compileCardVisual(card, baseSlide);
  const bullets = card.allowedBullets
    .map((bullet) => bullet.trim())
    .filter(Boolean)
    .filter((bullet, index, all) => all.findIndex((candidate) => sameText(candidate, bullet)) === index)
    .filter((bullet) => !sameText(bullet, card.title) && !sameText(bullet, card.screenThought))
    .slice(0, 3);
  const hasCustomCanvas = baseSlide.canvas?.elements.some((element) => element.id === `${baseSlide.id}-custom-canvas-marker`);

  return slideSchema.parse({
    ...baseSlide,
    title: card.title,
    thesis: card.screenThought,
    bullets,
    // Blocks are a legacy parallel text projection. Clearing them prevents
    // the same support sentence from rendering twice in a canonical deck.
    blocks: [],
    speakerNotes: card.speakerNotes,
    layout: slideLayoutForCard(card, baseSlide),
    visual,
    showSourceAttribution: false,
    canvas: hasCustomCanvas ? baseSlide.canvas : undefined,
  });
}

function compileCardVisual(card: SlideCard, slide: Slide): SlideVisual {
  if (card.visualStrategy === "none") {
    return emptyVisual();
  }

  if (card.visualStrategy === "diagram") {
    const labels = [...card.visualLabels, ...card.allowedBullets]
      .map((value) => compactDiagramLabel(value))
      .filter(Boolean)
      .filter((value, index, all) => all.findIndex((candidate) => sameText(candidate, value)) === index)
      .filter((value) => !sameText(value, card.title) && !sameText(value, card.screenThought))
      .slice(0, 3);
    // A provider diagram is only a payload donor. Its labels are not allowed
    // to become a second semantic source after accepted speech is locked.
    // Returning an empty visual here makes the final gate reject an
    // under-specified card instead of releasing provider prose or placeholders.
    if (labels.length < 2) return emptyVisualWithStory(card.visualStory);
    return groundedDiagram(labels, card.visualStory);
  }

  // An image strategy never fabricates an image URL. The release gate rejects
  // an unfulfilled image, while the real asset remains the sole visual donor.
  return slideVisualSchema.parse({
    ...slide.visual,
    // Visual titles are not owned by SlideCard. Keeping a provider title here
    // would create a competing visible text source and can duplicate the slide
    // title in the editor/export projection.
    title: "",
    description: card.visualStory,
    type: slide.visual.image ? (card.visualStrategy === "generated_illustration" ? "illustration" : "image") : slide.visual.type,
  });
}

function emptyVisualWithStory(description: string): SlideVisual {
  return slideVisualSchema.parse({ ...emptyVisual(), description });
}

function groundedDiagram(labels: string[], description: string): SlideVisual {
  const nodes = labels.map((label, index) => ({
    id: `card-node-${index + 1}`,
    label,
    detail: "",
  }));
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `card-edge-${index + 1}`,
    source: node.id,
    target: nodes[index + 1]!.id,
    label: "",
  }));
  const source = [
    "flowchart LR",
    ...labels.map((label, index) => `    N${index}[${mermaidLabel(label)}]`),
    ...labels.slice(0, -1).map((_, index) => `    N${index} --> N${index + 1}`),
  ].join("\n");
  return slideVisualSchema.parse({
    type: "process_diagram",
    title: "",
    description,
    leftLabel: "",
    rightLabel: "",
    items: [],
    rows: [],
    diagram: {
      kind: "flowchart",
      source,
      fallback: labels.join("\n"),
      title: "",
      caption: "",
      safety: "safe",
    },
    graph: {
      layoutDirection: "LR",
      nodes,
      edges,
      fallback: labels.join("\n"),
      title: "",
    },
  });
}

function emptyVisual(): SlideVisual {
  return { type: "none", title: "", description: "", leftLabel: "", rightLabel: "", items: [], rows: [] };
}

function compactDiagramLabel(value: string) {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?]+$/u, "")
    .split(" ")
    .slice(0, 6)
    .join(" ")
    .slice(0, 56);
}

function mermaidLabel(value: string) {
  return value.replace(/[<>{}[\]|"`]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 42) || "Идея";
}

function sameText(left: string, right: string) {
  return left.toLocaleLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    === right.toLocaleLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
