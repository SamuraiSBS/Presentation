import crypto from "node:crypto";
import type { DesignBriefSlideDirection, PresentationDocument, SlideVisualImage } from "@studydeck/shared";
import sharp from "sharp";
import { captureGenerationError, errorLogFields, logger } from "../observability.js";
import { putObjectBuffer } from "../storage.js";

type ProjectInput = {
  id: string;
  prompt: string;
  title: string;
};

type TavilyImage = string | { url?: string; description?: string };

type TavilyImageResult = {
  title?: string;
  url?: string;
  images?: TavilyImage[];
};

type TavilyImageResponse = {
  images?: TavilyImage[];
  results?: TavilyImageResult[];
};

export type ImageCandidate = {
  url: string;
  description: string;
  sourceUrl?: string;
  sourceTitle: string;
};

type DownloadedImage = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  width?: number;
  height?: number;
  byteSize?: number;
  warnings?: string[];
};

type ProcessPresentationImageOptions = {
  contentType?: string;
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
};

export type ProcessedPresentationImage = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  width?: number;
  height?: number;
  byteSize: number;
  warnings: string[];
};

type ImageSearchDependencies = {
  searchImages?: (query: string) => Promise<ImageCandidate[]>;
  downloadImage?: (url: string) => Promise<DownloadedImage>;
  putObject?: (key: string, buffer: Buffer, contentType: string) => Promise<void>;
  warn?: (message: string, error: unknown) => void;
};

const TAVILY_QUERY_MAX_LENGTH = 400;
const TAVILY_QUERY_SAFE_LENGTH = 380;

export async function enrichPresentationImages(
  project: ProjectInput,
  presentation: PresentationDocument,
  dependencies: ImageSearchDependencies = {},
): Promise<PresentationDocument> {
  if (!isPresentationImagesEnabled(dependencies)) {
    return presentation;
  }

  const usedUrls = new Set<string>();
  const usedDomains = new Set<string>();
  const searchImages = dependencies.searchImages || searchTavilyImages;
  const downloadImage = dependencies.downloadImage || downloadRemoteImage;
  const putObject = dependencies.putObject || putObjectBuffer;
  const warn = dependencies.warn || ((message, error) => logger.warn({ ...errorLogFields(error) }, message));

  const slides = [];
  for (const slide of presentation.slides) {
    const direction = presentation.designBrief?.slideDirections.find((item) => item.slideOrder === slide.order);
    if (!shouldSearchForSlideImage(slide, direction)) {
      slides.push(slide);
      continue;
    }

    try {
      const query = buildSlideImageQuery(project, slide, direction);
      const candidates = await searchImages(query);
      let image: SlideVisualImage | undefined;
      let lastDownloadError: unknown;

      while (!image) {
        const candidate = chooseImageCandidate(candidates, usedUrls, usedDomains);
        if (!candidate) break;

        try {
          const downloaded = await downloadImage(candidate.url);
          const hash = crypto.createHash("sha1").update(candidate.url).digest("hex").slice(0, 12);
          const objectKey = `projects/${project.id}/images/slide-${slide.order}-${hash}.${downloaded.extension}`;
          await putObject(objectKey, downloaded.buffer, downloaded.contentType);

          image = {
            url: candidate.url,
            objectKey,
            alt: buildImageAlt(slide.title, candidate.description),
            query,
            sourceUrl: candidate.sourceUrl || candidate.url,
            sourceTitle: candidate.sourceTitle,
            provider: "tavily",
            contentType: downloaded.contentType,
            width: downloaded.width,
            height: downloaded.height,
            byteSize: downloaded.byteSize ?? downloaded.buffer.length,
            warnings: downloaded.warnings || [],
          };
        } catch (error) {
          lastDownloadError = error;
        }
      }

      if (!image && lastDownloadError) throw lastDownloadError;
      slides.push(image
        ? {
            ...slide,
            visual: {
              ...slide.visual,
              image,
            },
          }
        : slide);
    } catch (error) {
      captureGenerationError(error, {
        projectId: project.id,
        stage: "selecting_visuals",
        provider: "tavily",
      });
      warn(`slide image lookup failed for slide ${slide.order}`, error);
      slides.push(slide);
    }
  }

  return {
    ...presentation,
    slides,
  };
}

export function buildSlideImageQuery(
  project: ProjectInput,
  slide: PresentationDocument["slides"][number],
  direction?: DesignBriefSlideDirection,
) {
  const subject = shorten(cleanText(direction?.visualPrompt || slide.visual.description || slide.title), 120);
  const medium = direction?.imageStrategy === "generated_illustration"
    ? "clear editorial illustration"
    : "authentic documentary photo";
  const parts = [
    subject,
    shorten(slide.title, 56),
    shorten(project.title, 48),
    medium,
  ]
    .map(cleanText)
    .filter(Boolean);

  const query = shorten(unique(parts).slice(0, 4).join(" "), Math.min(TAVILY_QUERY_SAFE_LENGTH, 240));
  return query.length <= TAVILY_QUERY_MAX_LENGTH ? query : query.slice(0, TAVILY_QUERY_MAX_LENGTH);
}

export function shouldSearchForSlideImage(
  slide: PresentationDocument["slides"][number],
  direction?: DesignBriefSlideDirection,
) {
  if (direction?.imageStrategy !== "real_photo") {
    return false;
  }

  const prompt = cleanText(direction.visualPrompt);
  if (!prompt) return false;
  if (hasAbstractVisualPrompt(prompt, slide)) return false;
  if (hasConcreteVisualEvidence(prompt, slide)) return true;

  const meaningfulWords = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !GENERIC_VISUAL_PROMPT_WORDS.has(word));
  const slideWords = cleanText(slide.title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3);

  return meaningfulWords.length >= 3 && meaningfulWords.some((word) => slideWords.includes(word));
}

const GENERIC_VISUAL_PROMPT_WORDS = new Set([
  "image", "photo", "picture", "visual", "illustration", "editorial", "educational", "presentation",
  "high", "quality", "clear", "real", "realistic", "картинка", "фото", "изображение", "иллюстрация",
  "визуал", "презентация", "слайд", "качественный", "реалистичный",
]);

const CONCRETE_VISUAL_PATTERNS = [
  /\b(person|people|students?|teachers?|leaders?|scientists?|writers?|artists?|city|country|map|factory|laboratory|museum|products?|devices?|cars?|building|monument|battle|protest|meeting|conference|portrait|photo|documentary|classroom|lecture hall)\b/i,
  /\b(человек|люди|студент|преподавател|учен[ыо]й|писател|художник|город|страна|карта|завод|лаборатор|музей|продукт|устройств|автомобил|здание|памятник|битва|протест|встреча|конференц|портрет|фото|документальн)\b/i,
  /\b(19|20)\d{2}\b/,
];

const ABSTRACT_VISUAL_PATTERNS = [
  /\b(theory|concept|principle|idea|overview|summary|conclusion|structure|process|workflow|framework|model|pros and cons|cause and effect)\b/i,
  /\b(теори|концепц|принцип|иде[яи]|обзор|итог|вывод|структур|процесс|этап|модель|схема|сравнение|причин|последств|плюсы|минусы)\b/i,
];

function hasConcreteVisualEvidence(prompt: string, _slide: PresentationDocument["slides"][number]) {
  const text = prompt;
  return CONCRETE_VISUAL_PATTERNS.some((pattern) => pattern.test(text));
}

function hasAbstractVisualPrompt(prompt: string, _slide: PresentationDocument["slides"][number]) {
  const text = prompt;
  return ABSTRACT_VISUAL_PATTERNS.some((pattern) => pattern.test(text))
    && !CONCRETE_VISUAL_PATTERNS.some((pattern) => pattern.test(text));
}

export function tavilyResponseToImageCandidates(payload: TavilyImageResponse): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];

  for (const image of payload.images || []) {
    const normalized = normalizeTavilyImage(image);
    if (normalized) {
      candidates.push({ ...normalized, sourceTitle: "" });
    }
  }

  for (const result of payload.results || []) {
    for (const image of result.images || []) {
      const normalized = normalizeTavilyImage(image);
      if (normalized) {
        candidates.push({
          ...normalized,
          sourceUrl: validUrl(result.url) ? result.url : undefined,
          sourceTitle: cleanText(result.title || ""),
        });
      }
    }
  }

  return uniqueByUrl(candidates);
}

export function chooseImageCandidate(candidates: ImageCandidate[], usedUrls = new Set<string>(), usedDomains = new Set<string>()) {
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate.url);
    const domain = url ? new URL(url).hostname.replace(/^www\./, "") : "";
    if (!url || usedUrls.has(url) || (domain && usedDomains.has(domain))) {
      continue;
    }

    usedUrls.add(url);
    if (domain) usedDomains.add(domain);
    return { ...candidate, url };
  }

  for (const candidate of candidates) {
    const url = normalizeUrl(candidate.url);
    if (!url || usedUrls.has(url)) {
      continue;
    }

    usedUrls.add(url);
    return { ...candidate, url };
  }

  return null;
}

async function searchTavilyImages(query: string): Promise<ImageCandidate[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is required for presentation image search");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: clampNumber(Number(process.env.PRESENTATION_IMAGE_SEARCH_RESULTS || 5), 1, 10),
      country: "russia",
      include_answer: false,
      include_raw_content: false,
      include_images: true,
      include_image_descriptions: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily image search failed: ${response.status} ${await response.text()}`);
  }

  return tavilyResponseToImageCandidates((await response.json()) as TavilyImageResponse);
}

async function downloadRemoteImage(url: string): Promise<DownloadedImage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), clampNumber(Number(process.env.PRESENTATION_IMAGE_TIMEOUT_MS || 8000), 1000, 30000));

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Image download failed: ${response.status}`);
    }

    const contentType = cleanText(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const extension = extensionFromContentType(contentType);
    if (!extension) {
      throw new Error(`Unsupported image content type: ${contentType || "unknown"}`);
    }

    const maxBytes = presentationImageMaxBytes();
    const downloadMaxBytes = presentationImageDownloadMaxBytes(maxBytes);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > downloadMaxBytes) {
      throw new Error(`Image is too large: ${contentLength} bytes`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error("Image response is empty");
    }
    if (buffer.length > downloadMaxBytes) {
      throw new Error(`Image is too large: ${buffer.length} bytes`);
    }

    return processPresentationImage(buffer, { contentType, maxBytes });
  } finally {
    clearTimeout(timeout);
  }
}

export async function processPresentationImage(
  buffer: Buffer,
  options: ProcessPresentationImageOptions = {},
): Promise<ProcessedPresentationImage> {
  const maxBytes = options.maxBytes ?? presentationImageMaxBytes();
  const maxWidth = options.maxWidth ?? presentationImageMaxDimension("PRESENTATION_IMAGE_MAX_WIDTH", 1920);
  const maxHeight = options.maxHeight ?? presentationImageMaxDimension("PRESENTATION_IMAGE_MAX_HEIGHT", 1080);
  const inputContentType = cleanText(options.contentType || "").split(";")[0].toLowerCase();
  const warnings: string[] = [];

  try {
    const source = sharp(buffer, { limitInputPixels: 48_000_000, failOn: "none" });
    const metadata = await source.metadata();
    const width = metadata.width;
    const height = metadata.height;
    const hasAlpha = Boolean(metadata.hasAlpha);
    const resized = source.rotate().resize({
      width: maxWidth,
      height: maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    });

    if ((width && width > maxWidth) || (height && height > maxHeight)) {
      warnings.push(`resized from ${width || "unknown"}x${height || "unknown"}`);
    }

    const format = hasAlpha ? "png" : "jpeg";
    const attempts = format === "jpeg" ? [82, 72, 62, 52] : [undefined];
    let best: Buffer | null = null;
    let bestMetadata: sharp.Metadata | null = null;

    for (const quality of attempts) {
      const candidate = format === "jpeg"
        ? await resized.clone().jpeg({ quality, mozjpeg: true }).toBuffer()
        : await resized.clone().png({ compressionLevel: 9, palette: true }).toBuffer();
      best = candidate;
      bestMetadata = await sharp(candidate).metadata();
      if (candidate.length <= maxBytes) break;
    }

    if (!best || !bestMetadata) {
      throw new Error("Image processing produced no output");
    }

    if (best.length > maxBytes) {
      if (buffer.length <= maxBytes) {
        warnings.push("processed image exceeded max bytes; kept original");
        return originalImageResult(buffer, inputContentType, warnings);
      }
      throw new Error(`Processed image is too large: ${best.length} bytes`);
    }

    if (best.length > buffer.length && buffer.length <= maxBytes && inputContentType) {
      warnings.push("processed image was larger; kept original");
      return originalImageResult(buffer, inputContentType, warnings);
    }

    return {
      buffer: best,
      contentType: format === "png" ? "image/png" : "image/jpeg",
      extension: format === "png" ? "png" : "jpg",
      width: bestMetadata.width,
      height: bestMetadata.height,
      byteSize: best.length,
      warnings,
    };
  } catch (error) {
    if (buffer.length <= maxBytes) {
      warnings.push(`processing failed; kept original: ${error instanceof Error ? error.message : "unknown error"}`);
      return originalImageResult(buffer, inputContentType, warnings);
    }
    throw error;
  }
}

function originalImageResult(buffer: Buffer, contentType: string, warnings: string[]): ProcessedPresentationImage {
  const safeContentType = contentType && extensionFromContentType(contentType) ? contentType : "image/jpeg";
  return {
    buffer,
    contentType: safeContentType,
    extension: extensionFromContentType(safeContentType) || "jpg",
    byteSize: buffer.length,
    warnings,
  };
}

function normalizeTavilyImage(image: TavilyImage): Omit<ImageCandidate, "sourceTitle"> | null {
  if (typeof image === "string") {
    const url = normalizeUrl(image);
    return url ? { url, description: "" } : null;
  }

  const url = normalizeUrl(image.url || "");
  return url ? { url, description: cleanText(image.description || "") } : null;
}

function uniqueByUrl(candidates: ImageCandidate[]) {
  const seen = new Set<string>();
  const uniqueCandidates: ImageCandidate[] = [];
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate.url);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    uniqueCandidates.push({ ...candidate, url });
  }
  return uniqueCandidates;
}

function buildImageAlt(title: string, description: string) {
  return shorten(cleanText(description) || `Иллюстрация к слайду: ${cleanText(title)}`, 180);
}

function extensionFromContentType(contentType: string) {
  if (contentType === "image/jpeg" || contentType === "image/jpg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "";
}

function presentationImageMaxBytes() {
  return clampNumber(Number(process.env.PRESENTATION_IMAGE_MAX_BYTES || 5_000_000), 100_000, 20_000_000);
}

function presentationImageDownloadMaxBytes(finalMaxBytes: number) {
  return clampNumber(
    Number(process.env.PRESENTATION_IMAGE_DOWNLOAD_MAX_BYTES || finalMaxBytes * 3),
    finalMaxBytes,
    40_000_000,
  );
}

function presentationImageMaxDimension(envName: string, fallback: number) {
  return clampNumber(Number(process.env[envName] || fallback), 320, 4096);
}

function isPresentationImagesEnabled(dependencies: ImageSearchDependencies) {
  if (process.env.PRESENTATION_IMAGES_ENABLED === "false") {
    return false;
  }

  return Boolean(dependencies.searchImages || process.env.TAVILY_API_KEY?.trim());
}

function normalizeUrl(value: string) {
  const text = cleanText(value);
  if (!validUrl(text)) return "";
  const parsed = new URL(text);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  return parsed.toString();
}

function validUrl(value: unknown): value is string {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function shorten(value: string, maxLength: number) {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}
