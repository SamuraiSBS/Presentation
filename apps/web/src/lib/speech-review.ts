export type SpeechSection = { order: number; title: string; text: string };

export function parseSpeechDraft(value: string, expectedCount = 1): SpeechSection[] {
  const lines = value.replace(/\r/g, "").split("\n");
  const sections: SpeechSection[] = [];
  let current: SpeechSection | null = null;
  for (const line of lines) {
    const header = line.trim().match(/^(?:#{1,3}\s*)?(?:слайд|slide)\s*(\d+)\s*[:.\-–—]?\s*(.*)$/iu);
    if (header) {
      if (current) sections.push({ ...current, text: current.text.trim() });
      current = { order: Number(header[1]) || sections.length + 1, title: header[2].trim() || `Слайд ${header[1]}`, text: "" };
    } else if (current) current.text += `${current.text ? "\n" : ""}${line}`;
  }
  if (current) sections.push({ ...current, text: current.text.trim() });
  if (sections.length) return sections;
  const paragraphs = value.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs.map((text, index) => ({ order: index + 1, title: `Слайд ${index + 1}`, text }));
  return [{ order: 1, title: expectedCount > 1 ? "Введение" : "Текст выступления", text: value.trim() }];
}

export function serializeSpeechSections(sections: SpeechSection[]) {
  return sections.map((section, index) => `Слайд ${index + 1}: ${section.title.trim() || `Слайд ${index + 1}`}\n${section.text.trim()}`).join("\n\n");
}
