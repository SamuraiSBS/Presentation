import { describe, expect, it } from "vitest";
import { sha256, type AiSceneV3SpeechSection } from "./speech-section-map.js";
import { aiSceneV3SemanticBriefContentHash, buildAiSceneV3CompactGroundedAnchors, validateAiSceneV3SemanticBrief } from "./semantic-brief.js";

const section: AiSceneV3SpeechSection = {
  slideId: "s2", slideOrder: 2, title: "Планеты", kind: "content",
  text: "Планеты движутся вокруг Солнца по орбитам и отличаются размерами. Земля относится к каменным планетам.",
  speechSectionHash: sha256({ slideId: "s2", slideOrder: 2, title: "Планеты", text: "Планеты движутся вокруг Солнца по орбитам и отличаются размерами. Земля относится к каменным планетам." }),
};

function brief() {
  const value = {
    version: 3 as const, slideId: "s2", slideOrder: 2, kind: "content" as const, speechSectionHash: section.speechSectionHash,
    title: { text: "Планеты" },
    anchors: [
      ["anchor:1", "Планеты движутся вокруг Солнца", "Планеты движутся вокруг Солнца по орбитам и отличаются размерами"],
      ["anchor:2", "Движутся вокруг Солнца по орбитам", "Планеты движутся вокруг Солнца по орбитам и отличаются размерами"],
      ["anchor:3", "Планеты отличаются размерами", "Планеты движутся вокруг Солнца по орбитам и отличаются размерами"],
      ["anchor:4", "Земля относится к каменным планетам", "Земля относится к каменным планетам"],
    ].map(([id, text, sourceTrace], index) => ({ id, text, sourceTrace, role: "fact" as const, priority: index + 1, visualCue: "separate celestial object with spatial relation" })),
    conclusion: { text: "Орбиты и состав отличают планеты" },
    visualNarrative: "Orbital system with distinct rocky planets and calm text zones.",
    allowedCompositionTypes: ["layered_explanation" as const, "comparison" as const],
  };
  return { ...value, contentHash: sha256({ slideId: value.slideId, slideOrder: value.slideOrder, speechSectionHash: value.speechSectionHash, title: value.title.text, subtitle: "", anchors: value.anchors.map((anchor) => ({ id: anchor.id, text: anchor.text, sourceTrace: anchor.sourceTrace })), conclusion: value.conclusion.text, visualNarrative: value.visualNarrative }) };
}

describe("AI Scene v3 semantic brief", () => {
  it("accepts only a fully grounded, content-hashed brief", () => {
    expect(validateAiSceneV3SemanticBrief(brief(), section).anchors).toHaveLength(4);
  });

  it("rejects an invented source trace", () => {
    const value = brief(); value.anchors[0]!.sourceTrace = "Несуществующий факт о галактике";
    expect(() => validateAiSceneV3SemanticBrief(value, section)).toThrow("ai_scene_v3_semantic_brief_ungrounded_anchor");
  });

  it("compacts long Russian source sentences while retaining exact DOCX traceability", () => {
    const longSpeech = "Солнце — звезда среднего размера, состоящая главным образом из водорода и гелия. В его центре происходят термоядерные реакции: ядра водорода объединяются в ядра гелия, а часть массы превращается в энергию. Эта энергия распространяется наружу в виде излучения и поддерживает условия, при которых на Земле возможны вода в жидком состоянии и жизнь. Солнце также испускает поток заряженных частиц, называемый солнечным ветром; он формирует гелиосферу и взаимодействует с магнитными полями планет.";
    const longSection = { ...section, text: longSpeech, speechSectionHash: sha256({ slideId: section.slideId, slideOrder: section.slideOrder, title: section.title, text: longSpeech }) };
    const anchors = buildAiSceneV3CompactGroundedAnchors(longSpeech);
    expect(anchors).toHaveLength(4);
    expect(anchors.every((anchor) => anchor.text.length <= 64 && longSpeech.includes(anchor.sourceTrace) && anchor.sourceTrace.includes(anchor.text))).toBe(true);
    const value = { version: 3 as const, slideId: longSection.slideId, slideOrder: longSection.slideOrder, kind: "content" as const, speechSectionHash: longSection.speechSectionHash, title: { text: longSection.title }, anchors, visualNarrative: "Scientific solar-system relationships with native text zones.", allowedCompositionTypes: ["layered_explanation" as const] };
    expect(validateAiSceneV3SemanticBrief({ ...value, contentHash: aiSceneV3SemanticBriefContentHash(value) }, longSection).anchors.map((anchor) => anchor.id)).toEqual(["anchor:1", "anchor:2", "anchor:3", "anchor:4"]);
  });
});
