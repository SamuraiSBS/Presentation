import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import JSZip from "jszip";
import OpenAI from "openai";
import PptxGenJS from "pptxgenjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);
const maxUploadBytes = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
    files: 8,
  },
});

app.use(express.json({ limit: "12mb" }));
app.use(express.static(__dirname));

app.post("/api/generate", upload.array("files", 8), async (req, res) => {
  try {
    const files = req.files || [];
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

    if (totalBytes > maxUploadBytes) {
      return res.status(413).json({ ok: false, error: "Загрузите файлы общим объемом до 50 МБ." });
    }

    const input = {
      prompt: cleanText(req.body.prompt || ""),
      scenario: cleanText(req.body.scenario || "Школьный доклад"),
      level: cleanText(req.body.level || "8-11 класс"),
      mode: cleanText(req.body.mode || "С источниками"),
      slideCount: clampNumber(Number(req.body.slideCount || 10), 4, 14),
    };

    const extractedSources = await extractFiles(files);
    const presentation = await generatePresentation(input, extractedSources);

    return res.json({ ok: true, presentation });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: "Не удалось собрать презентацию. Попробуйте короче описать задачу." });
  }
});

app.post("/api/export/pptx", async (req, res) => {
  try {
    const presentation = req.body?.presentation || req.body;
    validatePresentationForExport(presentation);

    const buffer = await createPptx(presentation);
    const safeName = slugify(presentation.title || "studydeck-presentation");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pptx"`);
    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ ok: false, error: "Не удалось экспортировать PPTX." });
  }
});

const pageRoutes = {
  "/": "index.html",
  "/prompt": "prompt.html",
  "/files": "files.html",
  "/plan": "plan.html",
  "/editor": "editor.html",
  "/export": "export.html",
};

Object.entries(pageRoutes).forEach(([route, fileName]) => {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(__dirname, fileName));
  });
});

app.listen(port, () => {
  console.log(`StudyDeck AI MVP: http://localhost:${port}`);
});

async function generatePresentation(input, extractedSources) {
  const normalizedSources = normalizeSources(input, extractedSources);

  if (process.env.OPENAI_API_KEY) {
    try {
      return await generateWithOpenAI(input, normalizedSources);
    } catch (error) {
      console.warn("OpenAI generation failed, using demo fallback:", error.message);
    }
  }

  return createDemoPresentation(input, normalizedSources, process.env.OPENAI_API_KEY ? "demo-fallback" : "demo");
}

async function generateWithOpenAI(input, sources) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-5.5";
  const sourceText = sources
    .map((source) => `[${source.id}] ${source.label}\n${source.excerpt}`)
    .join("\n\n")
    .slice(0, 18000);

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "Ты создаешь учебные презентации. Не делай работу вместо ученика: объясняй материал, показывай источники, добавляй заметки спикера и отдельный рассказ для выступления по каждому слайду. Верни только структурированный документ по схеме.",
      },
      {
        role: "user",
        content: [
          `Тема и запрос: ${input.prompt || "Учебная презентация"}`,
          `Сценарий: ${input.scenario}`,
          `Уровень: ${input.level}`,
          `Количество слайдов: ${input.slideCount}`,
          `Режим: ${input.mode}`,
          "Для поля speechScript напиши связный текст выступления по каждому слайду в формате: Слайд 1: Сегодня я расскажу... Текст должен опираться на запрос пользователя и загруженные материалы.",
          `Источники и фрагменты:\n${sourceText || "Источник только из запроса пользователя."}`,
        ].join("\n\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "studydeck_presentation",
        strict: true,
        schema: presentationSchema,
      },
    },
  });

  const parsed = parseOpenAIJson(response);
  const presentation = normalizePresentation(parsed, input, sources);
  presentation.generationMode = "openai";
  return presentation;
}

async function extractFiles(files) {
  const extracted = [];

  for (const file of files) {
    const originalName = decodeMaybeMojibake(file.originalname || `Файл ${extracted.length + 1}`);
    const extension = path.extname(originalName || "").toLowerCase();
    let text = "";

    try {
      if (extension === ".txt" || extension === ".md" || extension === ".csv") {
        text = file.buffer.toString("utf8");
      } else if (extension === ".docx") {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        text = result.value || "";
      } else if (extension === ".pptx") {
        text = await extractPptxText(file.buffer);
      } else if (extension === ".pdf") {
        text = await extractPdfText(file.buffer);
      } else {
        text = file.buffer.toString("utf8");
      }
    } catch (error) {
      console.warn(`Could not extract ${originalName}:`, error.message);
      text = "";
    }

    extracted.push({
      id: `src-${extracted.length + 1}`,
      label: originalName,
      type: extension.replace(".", "").toUpperCase() || "FILE",
      size: file.size,
      text: cleanText(text).slice(0, 9000),
    });
  }

  return extracted;
}

async function extractPdfText(buffer) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = pdfParseModule.default || pdfParseModule;
  const parsed = await pdfParse(buffer);
  return parsed.text || "";
}

async function extractPptxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));

  const chunks = [];

  for (const name of slideFiles) {
    const xml = await zip.files[name].async("string");
    chunks.push(xmlToText(xml));
  }

  return chunks.join("\n\n");
}

function normalizeSources(input, extractedSources) {
  const sources = extractedSources
    .map((source, index) => ({
      id: source.id || `src-${index + 1}`,
      label: source.label || `Источник ${index + 1}`,
      type: source.type || "FILE",
      excerpt: makeExcerpt(source.text, input.prompt),
      text: source.text || "",
    }))
    .filter((source) => source.excerpt);

  if (sources.length) {
    return sources;
  }

  return [
    {
      id: "src-prompt",
      label: "Запрос пользователя",
      type: "PROMPT",
      excerpt:
        input.prompt ||
        "Пользователь задал тему презентации. Для точных цитат и литературы загрузите PDF, DOCX, TXT или PPTX.",
      text: input.prompt || "",
    },
  ];
}

function createDemoPresentation(input, sources, generationMode) {
  const topic = extractTopic(input.prompt);
  const keySentences = extractKeySentences(sources);
  const slideCount = input.slideCount;
  const sourceRefs = sources.map((source, index) => ({
    sourceId: source.id,
    label: source.label,
    excerpt: source.excerpt,
    page: index === 0 && source.type === "PDF" ? "стр. 1" : null,
  }));
  const titles = buildSlideTitles(input.scenario, topic, slideCount);

  const slides = titles.map((title, index) => {
    const sentence = keySentences[index % keySentences.length] || `Материал раскрывает тему "${topic}" через понятные тезисы и примеры.`;
    const relatedSource = sourceRefs[index % sourceRefs.length];
    const isFirst = index === 0;
    const isLast = index === titles.length - 1;

    return {
      id: `slide-${index + 1}`,
      order: index + 1,
      title,
      layout: isFirst ? "hero" : isLast ? "summary" : index % 3 === 0 ? "two-column" : "bullets",
      blocks: [
        {
          type: "bullets",
          items: buildBullets({ index, topic, sentence, scenario: input.scenario, level: input.level, isLast }),
        },
        {
          type: "callout",
          content: isLast
            ? "Главный вывод должен быть понятен без чтения всех источников, но каждый тезис можно проверить."
            : simplifySentence(sentence),
        },
      ],
      speakerNotes: buildSpeakerNotes({ index, title, topic, sentence, source: relatedSource }),
      timingSeconds: isFirst || isLast ? 45 : 55,
      sourceRefs: [relatedSource],
    };
  });
  const speechScript = buildSpeechScript(slides, input, topic);

  return normalizePresentation(
    {
      id: crypto.randomUUID(),
      title: `${input.scenario}: ${topic}`,
      scenario: input.scenario,
      level: input.level,
      slideCount,
      generationMode,
      sources: sources.map(publicSource),
      outline: slides.map((slide) => slide.title),
      speechScript,
      slides,
    },
    input,
    sources,
  );
}

function normalizePresentation(raw, input, sources) {
  const publicSources = sources.map(publicSource);
  const slides = Array.isArray(raw.slides) ? raw.slides : [];
  const normalizedSlides = slides.slice(0, input.slideCount).map((slide, index) => normalizeSlide(slide, index + 1, publicSources));

  while (normalizedSlides.length < input.slideCount) {
    normalizedSlides.push(
      normalizeSlide(
        {
          id: `slide-${normalizedSlides.length + 1}`,
          title: `Слайд ${normalizedSlides.length + 1}`,
          blocks: [{ type: "bullets", items: ["Добавьте тезис из материала", "Свяжите мысль с источником"] }],
          speakerNotes: "Коротко объясните, почему этот тезис важен для темы.",
          sourceRefs: [sourceRefFromSource(publicSources[0])],
        },
        normalizedSlides.length + 1,
        publicSources,
      ),
    );
  }
  const speechScript = normalizeSpeechScript(raw.speechScript, normalizedSlides, input);

  return {
    id: raw.id || crypto.randomUUID(),
    title: raw.title || `${input.scenario}: ${extractTopic(input.prompt)}`,
    scenario: raw.scenario || input.scenario,
    level: raw.level || input.level,
    slideCount: normalizedSlides.length,
    generationMode: raw.generationMode || "demo",
    sources: publicSources,
    outline: Array.isArray(raw.outline) && raw.outline.length ? raw.outline : normalizedSlides.map((slide) => slide.title),
    speechScript,
    slides: normalizedSlides,
  };
}

function normalizeSlide(slide, order, sources, fallback = {}) {
  const sourceRefs = Array.isArray(slide.sourceRefs) && slide.sourceRefs.length
    ? slide.sourceRefs
    : fallback.sourceRefs || [sourceRefFromSource(sources[0])];
  const blocks = Array.isArray(slide.blocks) && slide.blocks.length ? slide.blocks : fallback.blocks || [];

  return {
    id: slide.id || fallback.id || `slide-${order}`,
    order: Number(slide.order || fallback.order || order),
    title: cleanText(slide.title || fallback.title || `Слайд ${order}`),
    layout: cleanText(slide.layout || fallback.layout || "bullets"),
    blocks: blocks.map(normalizeBlock).filter(Boolean),
    speakerNotes: cleanText(slide.speakerNotes || fallback.speakerNotes || "Расскажите этот слайд своими словами."),
    timingSeconds: clampNumber(Number(slide.timingSeconds || fallback.timingSeconds || 50), 20, 180),
    sourceRefs: sourceRefs.map((ref) => ({
      sourceId: ref.sourceId || sources[0]?.id || "src-prompt",
      label: cleanText(ref.label || sources.find((source) => source.id === ref.sourceId)?.label || "Источник"),
      excerpt: cleanText(ref.excerpt || sources.find((source) => source.id === ref.sourceId)?.excerpt || ""),
      page: ref.page || null,
    })),
  };
}

function normalizeSpeechScript(rawScript, slides, input) {
  const script = Array.isArray(rawScript) ? rawScript : [];
  const normalized = slides.map((slide, index) => {
    const source = script.find((item) => Number(item?.slideOrder) === slide.order) || script[index] || {};
    return {
      slideOrder: slide.order || index + 1,
      slideTitle: cleanText(source.slideTitle || slide.title || `Слайд ${index + 1}`),
      text: cleanText(source.text || buildSpeechText(slide, input, index)),
    };
  });

  return normalized.filter((item) => item.text);
}

function normalizeBlock(block) {
  if (!block || typeof block !== "object") {
    return null;
  }

  if (block.type === "bullets") {
    return {
      type: "bullets",
      items: Array.isArray(block.items) ? block.items.map(cleanText).filter(Boolean).slice(0, 5) : [],
    };
  }

  return {
    type: block.type === "quote" ? "quote" : "callout",
    content: cleanText(block.content || ""),
  };
}

async function createPptx(presentation) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "StudyDeck AI";
  pptx.company = "StudyDeck AI";
  pptx.subject = presentation.scenario || "Учебная презентация";
  pptx.title = presentation.title || "StudyDeck AI";
  pptx.lang = "ru-RU";
  pptx.theme = {
    headFontFace: "Arial",
    bodyFontFace: "Arial",
    lang: "ru-RU",
  };

  for (const item of presentation.slides || []) {
    const slide = pptx.addSlide();
    slide.background = { color: "FBFAF5" };
    slide.addText(item.title || `Слайд ${item.order}`, {
      x: 0.55,
      y: 0.35,
      w: 12.1,
      h: 0.65,
      fontFace: "Arial",
      fontSize: 25,
      bold: true,
      color: "17201B",
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });

    const bullets = slideBullets(item);
    slide.addText(
      bullets.map((text) => ({ text, options: { bullet: { indent: 18 }, hanging: 4 } })),
      {
        x: 0.75,
        y: 1.25,
        w: 7.5,
        h: 3.8,
        fontFace: "Arial",
        fontSize: 17,
        color: "27362F",
        valign: "top",
        breakLine: false,
        fit: "shrink",
      },
    );

    const callout = item.blocks?.find((block) => block.type !== "bullets")?.content || "";
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 8.65,
      y: 1.3,
      w: 3.9,
      h: 2.2,
      fill: { color: "17201B" },
      line: { color: "17201B" },
      radius: 0.12,
    });
    slide.addText(callout || "Заметка: проговорите тезис своими словами.", {
      x: 8.9,
      y: 1.55,
      w: 3.4,
      h: 1.6,
      fontFace: "Arial",
      fontSize: 13,
      color: "FFFFFF",
      fit: "shrink",
      breakLine: false,
    });

    const sourceLine = (item.sourceRefs || [])
      .map((ref) => `${ref.label}${ref.page ? `, ${ref.page}` : ""}`)
      .join("; ");
    slide.addText(`Источник: ${sourceLine || "добавьте источник"}`, {
      x: 0.55,
      y: 6.75,
      w: 12.1,
      h: 0.25,
      fontFace: "Arial",
      fontSize: 9,
      color: "66716B",
      margin: 0,
      fit: "shrink",
    });

    if (typeof slide.addNotes === "function") {
      const scriptItem =
        (presentation.speechScript || []).find((entry) => Number(entry.slideOrder) === Number(item.order)) ||
        (presentation.speechScript || [])[Number(item.order || 1) - 1];
      slide.addNotes([
        item.speakerNotes || "",
        "",
        "Рассказ:",
        scriptItem?.text || "",
      ].join("\n"));
    }
  }

  return pptx.write({ outputType: "nodebuffer" });
}

function validatePresentationForExport(presentation) {
  if (!presentation || !Array.isArray(presentation.slides) || !presentation.slides.length) {
    throw new Error("No slides to export");
  }
}

function parseOpenAIJson(response) {
  if (response.output_parsed) {
    return response.output_parsed;
  }

  const text = response.output_text || response.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text;

  if (!text) {
    throw new Error("OpenAI response has no JSON text");
  }

  return JSON.parse(text);
}

function publicSource(source) {
  return {
    id: source.id,
    label: source.label,
    type: source.type,
    excerpt: source.excerpt || makeExcerpt(source.text || "", ""),
  };
}

function sourceRefFromSource(source) {
  return {
    sourceId: source?.id || "src-prompt",
    label: source?.label || "Запрос пользователя",
    excerpt: source?.excerpt || "",
    page: null,
  };
}

function buildSlideTitles(scenario, topic, count) {
  const common = [
    `Тема: ${topic}`,
    "Почему это важно",
    "Ключевые понятия",
    "Главные тезисы из материалов",
    "Пример или кейс",
    "Что говорят источники",
    "Объяснение простыми словами",
    "Рассказ для выступления",
    "Выводы",
    "Список источников",
  ];
  const project = [
    `Проект: ${topic}`,
    "Проблема и цель",
    "Гипотеза",
    "Методика работы",
    "Что получилось",
    "Доказательства из источников",
    "Риски и ограничения",
    "Рассказ о результате",
    "Вывод",
    "Источники",
  ];
  const lesson = [
    `Урок: ${topic}`,
    "Цели урока",
    "Актуализация знаний",
    "Новая тема",
    "Пример для класса",
    "Задание",
    "Проверка понимания",
    "Домашнее задание",
    "Итоги",
    "Материалы",
  ];
  const pool = /проект|защита/i.test(scenario) ? project : /урок/i.test(scenario) ? lesson : common;
  const titles = [];

  for (let index = 0; index < count; index += 1) {
    titles.push(pool[index] || `${index + 1}. ${topic}`);
  }

  return titles;
}

function buildBullets({ index, topic, sentence, scenario, level, isLast }) {
  if (isLast) {
    return [
      `Коротко повторить главную идею темы "${topic}".`,
      "Назвать 2-3 доказательства из источников.",
      "Показать, какой вывод слушатель должен запомнить.",
    ];
  }

  const base = [
    sentence,
    `Для сценария "${scenario}" важно говорить на уровне: ${level}.`,
    "Каждый тезис лучше подкреплять ссылкой на материал.",
  ];

  if (index === 0) {
    return [`Тема выступления: ${topic}.`, "Цель: разобраться в материале и объяснить его аудитории.", sentence];
  }

  if (index % 3 === 0) {
    base.push("Добавьте один пример, чтобы аудитория быстрее поняла мысль.");
  }

  return base;
}

function buildSpeakerNotes({ index, title, topic, sentence, source }) {
  return [
    `Слайд ${index + 1}: ${title}.`,
    `Начните с короткой связки с темой "${topic}".`,
    `Основная мысль: ${sentence}`,
    `Источник для проверки: ${source?.label || "запрос пользователя"}.`,
  ].join("\n");
}

function buildSpeechScript(slides, input, topic) {
  return slides.map((slide, index) => ({
    slideOrder: slide.order || index + 1,
    slideTitle: slide.title,
    text: buildSpeechText(slide, input, index, topic),
  }));
}

function buildSpeechText(slide, input, index, topic = extractTopic(input.prompt)) {
  const bullets = slideBullets(slide).slice(0, 3).map(shortenSentence);
  const source = slide.sourceRefs?.[0]?.label || "материалов";
  const spokenTopic = cleanText(topic).replace(/^(про|о|об)\s+/i, "");
  const intro = index === 0
    ? `Сегодня я расскажу вам про ${spokenTopic || topic}.`
    : `На этом слайде я объясню раздел "${slide.title}".`;
  const body = bullets.length ? bullets.join(" ") : slide.speakerNotes || "";
  return `${intro} ${body} Эта часть опирается на ${source}, поэтому ее можно связать с загруженными материалами.`;
}

function extractKeySentences(sources) {
  const sentences = sources
    .flatMap((source) => splitSentences(source.excerpt || source.text || ""))
    .filter((sentence) => sentence.length > 35)
    .slice(0, 16);

  return sentences.length ? sentences : ["Материал нужно разобрать на понятные тезисы, примеры и выводы."];
}

function makeExcerpt(text, prompt) {
  const normalized = cleanText(text);

  if (!normalized) {
    return "";
  }

  const sentences = splitSentences(normalized);
  const promptWords = new Set(cleanText(prompt).toLowerCase().split(/\s+/).filter((word) => word.length > 4));
  const scored = sentences
    .map((sentence) => ({
      sentence,
      score: sentence
        .toLowerCase()
        .split(/\s+/)
        .reduce((sum, word) => sum + (promptWords.has(word) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = (scored[0]?.score ? scored.slice(0, 4) : sentences.slice(0, 4)).map((item) => item.sentence || item);
  return selected.join(" ").slice(0, 1100);
}

function splitSentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractTopic(prompt) {
  const quoted = prompt.match(/[«"]([^»"]+)[»"]/);
  if (quoted?.[1]) {
    return cleanText(quoted[1]).slice(0, 80);
  }

  return cleanText(prompt)
    .replace(/^сделай\s+/i, "")
    .replace(/^подготовь\s+/i, "")
    .replace(/^презентац(ию|ия)\s+(на\s+\d+\s+слайд(ов|а)?\s+)?(по\s+теме\s+)?/i, "")
    .slice(0, 80) || "Учебная тема";
}

function simplifySentence(sentence) {
  return `Простыми словами: ${shortenSentence(sentence).replace(/\.$/, "")}.`;
}

function shortenSentence(sentence) {
  const clean = cleanText(sentence);
  return clean.length > 130 ? `${clean.slice(0, 127).trim()}...` : clean;
}

function slideBullets(slide) {
  const bullets = [];

  for (const block of slide.blocks || []) {
    if (block.type === "bullets") {
      bullets.push(...(block.items || []));
    } else if (block.content) {
      bullets.push(block.content);
    }
  }

  return bullets.length ? bullets.slice(0, 6) : ["Добавьте тезис", "Добавьте пример", "Добавьте источник"];
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlToText(xml) {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, " "));
}

function decodeXmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function decodeMaybeMojibake(value) {
  const text = String(value || "");

  if (!/[ÐÑРС]/.test(text)) {
    return text;
  }

  try {
    const decoded = Buffer.from(text, "latin1").toString("utf8");
    return decoded.includes("�") ? text : decoded;
  } catch {
    return text;
  }
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function slugify(value) {
  const ascii = String(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

  return ascii || "studydeck-presentation";
}

const blockSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["bullets", "callout", "quote"] },
    items: { type: "array", items: { type: "string" } },
    content: { type: "string" },
  },
  required: ["type", "items", "content"],
};

const sourceRefSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceId: { type: "string" },
    label: { type: "string" },
    excerpt: { type: "string" },
    page: { type: ["string", "null"] },
  },
  required: ["sourceId", "label", "excerpt", "page"],
};

const slideSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    order: { type: "number" },
    title: { type: "string" },
    layout: { type: "string", enum: ["hero", "bullets", "two-column", "summary"] },
    blocks: { type: "array", items: blockSchema },
    speakerNotes: { type: "string" },
    timingSeconds: { type: "number" },
    sourceRefs: { type: "array", items: sourceRefSchema },
  },
  required: ["id", "order", "title", "layout", "blocks", "speakerNotes", "timingSeconds", "sourceRefs"],
};

const speechScriptItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    slideOrder: { type: "number" },
    slideTitle: { type: "string" },
    text: { type: "string" },
  },
  required: ["slideOrder", "slideTitle", "text"],
};

const presentationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    scenario: { type: "string" },
    level: { type: "string" },
    slideCount: { type: "number" },
    generationMode: { type: "string" },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          type: { type: "string" },
          excerpt: { type: "string" },
        },
        required: ["id", "label", "type", "excerpt"],
      },
    },
    outline: { type: "array", items: { type: "string" } },
    speechScript: { type: "array", items: speechScriptItemSchema },
    slides: { type: "array", items: slideSchema },
  },
  required: ["id", "title", "scenario", "level", "slideCount", "generationMode", "sources", "outline", "speechScript", "slides"],
};
