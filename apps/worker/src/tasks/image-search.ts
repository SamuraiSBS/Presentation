import crypto from "node:crypto";
import type { PresentationDocument, SlideVisualImage } from "@studydeck/shared";
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
  const warn = dependencies.warn || ((message, error) => console.warn(message, error));

  const slides = [];
  for (const slide of presentation.slides) {
    try {
      const query = buildSlideImageQuery(project, slide);
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
      warn(`Slide image lookup failed for slide ${slide.order}`, error);
      slides.push(slide);
    }
  }

  return {
    ...presentation,
    slides,
  };
}

export function buildSlideImageQuery(project: ProjectInput, slide: PresentationDocument["slides"][number]) {
  const parts = [
    "educational presentation image",
    slide.title,
    slide.visual.description,
    slide.thesis,
    project.title,
    project.prompt,
    ...slide.bullets.slice(0, 3),
  ]
    .map(cleanText)
    .filter(Boolean);

  const query = shorten([...unique(parts).slice(0, 7), "high quality photo or clear illustration"].join(" "), TAVILY_QUERY_SAFE_LENGTH);
  return query.length <= TAVILY_QUERY_MAX_LENGTH ? query : query.slice(0, TAVILY_QUERY_MAX_LENGTH);
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

    const maxBytes = clampNumber(Number(process.env.PRESENTATION_IMAGE_MAX_BYTES || 5_000_000), 100_000, 20_000_000);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      throw new Error(`Image is too large: ${contentLength} bytes`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error("Image response is empty");
    }
    if (buffer.length > maxBytes) {
      throw new Error(`Image is too large: ${buffer.length} bytes`);
    }

    return { buffer, contentType, extension };
  } finally {
    clearTimeout(timeout);
  }
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
