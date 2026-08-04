export const jsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {},
};

export const narrativePlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slideOrder: { type: "number" },
          slideTitle: { type: "string" },
          slidePurpose: { type: "string" },
          keyMessage: { type: "string" },
          audienceQuestion: { type: "string" },
          transitionToNext: { type: "string" },
        },
        required: ["slideOrder", "slideTitle", "slidePurpose", "keyMessage", "audienceQuestion", "transitionToNext"],
      },
    },
  },
  required: ["slides"],
};

export const designBriefJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    themeId: {
      type: "string",
      enum: [
        "studydeckEditorial",
      ],
    },
    mood: { type: "string", enum: ["dark", "light", "playful", "serious", "neutral"] },
    audienceFit: { type: "string" },
    visualMetaphor: { type: "string" },
    colorIntent: { type: "string" },
    typographyIntent: { type: "string" },
    rhythm: {
      type: "object",
      additionalProperties: false,
      properties: {
        titleStyle: { type: "string", enum: ["bold", "quiet", "editorial", "academic"] },
        density: { type: "string", enum: ["low", "medium", "high"] },
        imageFrequency: { type: "string", enum: ["rare", "balanced", "frequent"] },
        sectionBreaks: { type: "boolean" },
      },
      required: ["titleStyle", "density", "imageFrequency", "sectionBreaks"],
    },
    slideDirections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slideOrder: { type: "number" },
          visualRole: { type: "string", enum: ["hero", "problem", "context", "explain", "compare", "sequence", "evidence", "quote", "visual_statement", "reflect", "summary"] },
          layoutIntent: { type: "string", enum: ["full_bleed_image", "split_image_text", "statement", "cards", "timeline", "diagram", "comparison", "evidence_board", "quote_spread", "metric", "summary"] },
          imageStrategy: { type: "string", enum: ["real_photo", "generated_illustration", "diagram", "none"] },
          sceneTextMode: { type: "string", enum: ["hero_phrase", "talk_sentences", "visual_labels", "takeaway"] },
          visualPrompt: { type: "string" },
        },
        required: ["slideOrder", "visualRole", "layoutIntent", "imageStrategy", "sceneTextMode", "visualPrompt"],
      },
    },
  },
  required: ["themeId", "mood", "audienceFit", "visualMetaphor", "colorIntent", "typographyIntent", "rhythm", "slideDirections"],
};

export const slideTextRepairSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          slideOrder: { type: "number" },
        },
        required: ["slideOrder"],
      },
    },
  },
  required: ["slides"],
};

export const qualityDimensionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    reason: { type: "string" },
  },
  required: ["score", "reason"],
};

export const qualityCritiqueJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    summary: { type: "string" },
    dimensions: {
      type: "object",
      additionalProperties: false,
      properties: {
        speechNaturalness: qualityDimensionJsonSchema,
        universityTone: qualityDimensionJsonSchema,
        slideBrevity: qualityDimensionJsonSchema,
        visualRhythm: qualityDimensionJsonSchema,
        sourceGrounding: qualityDimensionJsonSchema,
        exportReadiness: qualityDimensionJsonSchema,
      },
      required: ["speechNaturalness", "universityTone", "slideBrevity", "visualRhythm", "sourceGrounding", "exportReadiness"],
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slideId: { type: "string" },
          severity: { type: "string", enum: ["blocker", "major", "minor"] },
          category: {
            type: "string",
            enum: [
              "generic_text",
              "off_topic",
              "too_long",
              "duplicate",
              "bad_narration",
              "bad_visual",
              "factual_risk",
              "schema_risk",
            ],
          },
          field: { type: "string" },
          message: { type: "string" },
          repairInstruction: { type: "string" },
        },
        required: ["slideId", "severity", "category", "field", "message", "repairInstruction"],
      },
    },
  },
  required: ["score", "summary", "dimensions", "issues"],
};

export const qualityRepairJsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    generatedText: { type: "string" },
    outline: { type: "array", items: { type: "string" } },
    speechScript: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          slideOrder: { type: "number" },
          slideTitle: { type: "string" },
          text: { type: "string" },
        },
        required: ["slideOrder", "slideTitle", "text"],
      },
    },
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          slideId: { type: "string" },
          slideOrder: { type: "number" },
          title: { type: "string" },
          layout: { type: "string", enum: [
            "hero", "bullets", "two-column", "summary", "statement", "quote", "definition", "timeline",
            "comparison", "process", "image-focus", "case-study", "question-answer", "myth-fact", "metrics",
            "evidence", "problem-solution", "explain-example",
          ] },
          thesis: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          speakerNotes: { type: "string" },
        },
        required: ["slideId", "slideOrder", "title", "layout", "thesis", "bullets", "speakerNotes"],
      },
    },
  },
  required: ["slides"],
};
