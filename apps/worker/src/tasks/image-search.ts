import crypto from "node:crypto";
import { COST_ENVELOPE_BUCKETS, type DesignBriefSlideDirection, type PresentationDocument, type SlideVisualImage } from "@studydeck/shared";
import sharp, { type Metadata } from "sharp";
import { captureGenerationError, errorLogFields, logger } from "../observability.js";
import { putObjectBuffer } from "../storage.js";
import { currentUsageContext, recordCostEvent } from "../usage-ledger.js";
import { failCostEnvelope, reserveCostEnvelope, settleCostEnvelope } from "../cost-envelope.js";
import { generateAitunnelImage, type AitunnelImageGenerationResult } from "./aitunnel-image-generation.js";
import { isAitunnelImageProviderEnabled, presentationImageProvider } from "./presentation-image-provider.js";

type ProjectInput = {
  id: string;
  prompt: string;
  title: string;
  workflow?: string;
  allowWebImages?: boolean;
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

type ImageCandidateContext = {
  query?: string;
  slideTitle?: string;
  projectTitle?: string;
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

type ImageReservation = { envelopeId: string; idempotencyKey: string };
type ImageReservationResult = ImageReservation | "blocked" | undefined;

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
  generateImage?: (prompt: string) => Promise<AitunnelImageGenerationResult>;
  downloadImage?: (url: string) => Promise<DownloadedImage>;
  putObject?: (key: string, buffer: Buffer, contentType: string) => Promise<void>;
  reserveImageBucket?: (slideOrder: number) => Promise<ImageReservationResult>;
  settleImageBucket?: (reservation: ImageReservationResult, actualRub?: string) => Promise<void>;
  failImageBucket?: (reservation: ImageReservationResult) => Promise<void>;
  warn?: (message: string, error: unknown) => void;
};

const TAVILY_QUERY_MAX_LENGTH = 400;
const TAVILY_QUERY_SAFE_LENGTH = 380;
const ECONOMIC_IMAGE_HARD_MAX = 2;
const ECONOMIC_IMAGE_RESERVATION_RUB = String(Number(COST_ENVELOPE_BUCKETS.images) / ECONOMIC_IMAGE_HARD_MAX);

export async function enrichPresentationImages(
  project: ProjectInput,
  presentation: PresentationDocument,
  dependencies: ImageSearchDependencies = {},
): Promise<PresentationDocument> {
  if (project.workflow === "requirements_driven" && project.allowWebImages !== true) {
    return presentation;
  }
  if (!isPresentationImagesEnabled(dependencies)) {
    return presentation;
  }

  const usedUrls = new Set<string>();
  const usedDomains = new Set<string>();
  const searchImages = dependencies.searchImages || searchTavilyImages;
  const generateImage = dependencies.generateImage || generateAitunnelImage;
  const downloadImage = dependencies.downloadImage || downloadRemoteImage;
  const putObject = dependencies.putObject || putObjectBuffer;
  const reserveImage = dependencies.reserveImageBucket || reserveImageBucket;
  const settleImage = dependencies.settleImageBucket || settleImageBucket;
  const failImage = dependencies.failImageBucket || failImageBucket;
  const warn = dependencies.warn || ((message, error) => logger.warn({ ...errorLogFields(error) }, message));

  const slides = [];
  const fallbackDirections = new Map<number, DesignBriefSlideDirection>();
  const permittedImageOrders = permittedImageSlideOrders(presentation);
  for (const slide of presentation.slides) {
    const direction = presentation.designBrief?.slideDirections.find((item) => item.slideOrder === slide.order);
    const isRealPhoto = shouldSearchForSlideImage(slide, direction);
    const isGeneratedIllustration = shouldGenerateForSlideImage(slide, direction);
    if (!permittedImageOrders.has(slide.order) || (!isRealPhoto && !isGeneratedIllustration)) {
      const fallback = safeVisualFallback(direction, slide);
      if (fallback) fallbackDirections.set(fallback.slideOrder, fallback);
      slides.push(fallback ? fallbackSlideForMissingPhoto(slide, direction) : slide);
      continue;
    }

    try {
      let image: SlideVisualImage | undefined;
      const query = buildSlideImageQuery(project, slide, direction);
      const reservation = await reserveImage(slide.order);
      if (reservation === "blocked") {
        const fallback = safeVisualFallback(direction, slide);
        if (fallback) fallbackDirections.set(fallback.slideOrder, fallback);
        slides.push(fallbackSlideForMissingPhoto(slide, direction));
        continue;
      }

      if (isGeneratedIllustration) {
        let image: SlideVisualImage | undefined;
        try {
          const generated = await generateImage(query);
          const processed = await processPresentationImage(generated.buffer, {
            contentType: generated.contentType,
            maxBytes: presentationImageMaxBytes(),
          });
          const hash = crypto.createHash("sha1").update(`${project.id}:${slide.order}:${generated.model}:${query}`).digest("hex").slice(0, 12);
          const objectKey = `projects/${project.id}/images/slide-${slide.order}-aitunnel-${hash}.${processed.extension}`;
          await putObject(objectKey, processed.buffer, processed.contentType);
          await recordStoredImageCost(project.id, objectKey, processed.byteSize, currentUsageContext());
          image = {
            // AITUNNEL returns base64 only; the MinIO object is the canonical
            // asset reference, so never persist the API endpoint as an image URL.
            url: "",
            objectKey,
            alt: buildImageAlt(slide.title, query),
            query,
            sourceTitle: "AI-generated by AITUNNEL",
            provider: "aitunnel",
            contentType: processed.contentType,
            width: processed.width,
            height: processed.height,
            byteSize: processed.byteSize,
            warnings: processed.warnings,
          };
          await settleImage(reservation, generated.actualCostRub);
        } catch (error) {
          await failImage(reservation);
          captureGenerationError(error, { projectId: project.id, stage: "selecting_visuals", provider: "aitunnel" });
          warn(`slide AITUNNEL image generation failed for slide ${slide.order}`, error);
        }

        if (!image) {
          const fallback = safeVisualFallback(direction, slide);
          if (fallback) fallbackDirections.set(fallback.slideOrder, fallback);
        }
        slides.push(image
          ? { ...slide, visual: { ...slide.visual, image } }
          : fallbackSlideForMissingPhoto(slide, direction));
        continue;
      }

      let candidates: ImageCandidate[] = [];
      try {
        candidates = await searchImages(query);
      } catch {
        // The request budget is consumed even when Tavily fails, so do not
        // retry it with a refined prompt or a second provider call.
      }

      while (!image) {
        const candidate = chooseImageCandidate(candidates, usedUrls, usedDomains, {
          query,
          slideTitle: slide.title,
          projectTitle: project.title,
        });
        if (!candidate) break;

        try {
          const downloaded = await downloadImage(candidate.url);
          const hash = crypto.createHash("sha1").update(candidate.url).digest("hex").slice(0, 12);
          const objectKey = `projects/${project.id}/images/slide-${slide.order}-${hash}.${downloaded.extension}`;
          await putObject(objectKey, downloaded.buffer, downloaded.contentType);
          const usage = currentUsageContext();
          await recordCostEvent({
            idempotencyKey: crypto.createHash("sha256").update(`${usage?.generationJobId || usage?.queueJobId || project.id}:storage:${objectKey}`).digest("hex"),
            category: "storage",
            provider: process.env.S3_ENDPOINT?.includes("localhost") || process.env.S3_ENDPOINT?.includes("minio") ? "minio" : "object_storage",
            quantity: String(downloaded.byteSize ?? downloaded.buffer.length),
            unit: "stored_byte_month",
            unitPrice: process.env.STORAGE_PRICE_USD_PER_BYTE_MONTH,
            currency: "USD",
            measurement: "calculated",
          });

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
        } catch {}
      }
      await settleImage(reservation);

      if (!image) {
        const fallback = safeVisualFallback(direction, slide);
        if (fallback) fallbackDirections.set(fallback.slideOrder, fallback);
      }
      slides.push(image
        ? {
            ...slide,
            visual: {
              ...slide.visual,
              image,
            },
          }
        : fallbackSlideForMissingPhoto(slide, direction));
    } catch (error) {
      captureGenerationError(error, {
        projectId: project.id,
        stage: "selecting_visuals",
        provider: "tavily",
      });
      warn(`slide image lookup failed for slide ${slide.order}`, error);
      const fallback = safeVisualFallback(direction, slide);
      if (fallback) fallbackDirections.set(fallback.slideOrder, fallback);
      slides.push(fallbackSlideForMissingPhoto(slide, direction));
    }
  }

  return {
    ...presentation,
    slides,
    designBrief: presentation.designBrief && fallbackDirections.size
      ? {
          ...presentation.designBrief,
          slideDirections: presentation.designBrief.slideDirections.map((direction) => fallbackDirections.get(direction.slideOrder) || direction),
        }
      : presentation.designBrief,
  };
}

export function buildSlideImageQuery(
  project: ProjectInput,
  slide: PresentationDocument["slides"][number],
  direction?: DesignBriefSlideDirection,
) {
  const visualPrompt = cleanText(direction?.visualPrompt || slide.visual.description || slide.title);
  const historical = /\b(?:history|historical|first generation|generation|vintage|classic|19\d{2}|20\d{2})\b|(?:истори|поколени|архив|\b\d{4}\b)/iu.test(`${slide.title} ${visualPrompt}`);
  const medium = direction?.imageStrategy === "generated_illustration"
    ? "editorial illustration"
    : historical
      ? "historical photograph"
      : "documentary photograph";
  return sanitizeImageQuery([
    shorten(visualPrompt, 120),
    shorten(slide.title, 64),
    shorten(project.title, 72),
    medium,
  ].join(" "));
}

/** A slide gets exactly one anchored Tavily request in an economic run. */
export function buildRefinedImageQueries(
  project: ProjectInput,
  slide: PresentationDocument["slides"][number],
  direction?: DesignBriefSlideDirection,
) {
  return [buildSlideImageQuery(project, slide, direction)].filter(Boolean);
}

/** One web photo per five slides, rounded up, never more than two per deck. */
export function economicPhotoLimit(slideCount: number) {
  return Math.min(ECONOMIC_IMAGE_HARD_MAX, Math.max(0, Math.ceil(Math.max(0, slideCount) / 5)));
}

function permittedImageSlideOrders(presentation: PresentationDocument) {
  const limit = economicPhotoLimit(presentation.slides.length);
  const directions = presentation.designBrief?.slideDirections || [];
  return new Set(
    directions
      .filter((direction) => direction.imageStrategy === "real_photo" || direction.imageStrategy === "generated_illustration")
      .filter((direction) => {
        const slide = presentation.slides.find((item) => item.order === direction.slideOrder);
        return Boolean(slide && (shouldSearchForSlideImage(slide, direction) || shouldGenerateForSlideImage(slide, direction)));
      })
      .slice(0, limit)
      .map((direction) => direction.slideOrder),
  );
}

async function reserveImageBucket(slideOrder: number): Promise<ImageReservationResult> {
  const envelopeId = currentUsageContext()?.costEnvelopeId;
  if (!envelopeId) return undefined;
  const idempotencyKey = `${envelopeId}:presentation-image:${slideOrder}`;
  const reservation = await reserveCostEnvelope({
    envelopeId,
    idempotencyKey,
    bucket: "images",
    stage: "presentation_image_search",
    amountRub: ECONOMIC_IMAGE_RESERVATION_RUB,
  });
  return reservation.status === "reserved" ? { envelopeId, idempotencyKey } : "blocked" as const;
}

async function settleImageBucket(reservation: ImageReservationResult, actualRub?: string) {
  if (!reservation || reservation === "blocked") return;
  await settleCostEnvelope({ ...reservation, actualRub: actualRub || ECONOMIC_IMAGE_RESERVATION_RUB, reason: "presentation_image_search" }).catch(() => undefined);
}

async function failImageBucket(reservation: ImageReservationResult) {
  if (!reservation || reservation === "blocked") return;
  await failCostEnvelope({ ...reservation, reason: "presentation_image_provider_failure" }).catch(() => undefined);
}

async function recordStoredImageCost(projectId: string, objectKey: string, byteSize: number, usage: ReturnType<typeof currentUsageContext>) {
  await recordCostEvent({
    idempotencyKey: crypto.createHash("sha256").update(`${usage?.generationJobId || usage?.queueJobId || projectId}:storage:${objectKey}`).digest("hex"),
    category: "storage",
    provider: process.env.S3_ENDPOINT?.includes("localhost") || process.env.S3_ENDPOINT?.includes("minio") ? "minio" : "object_storage",
    quantity: String(byteSize),
    unit: "stored_byte_month",
    unitPrice: process.env.STORAGE_PRICE_USD_PER_BYTE_MONTH,
    currency: "USD",
    measurement: "calculated",
  });
}

export function shouldSearchForSlideImage(
  slide: PresentationDocument["slides"][number],
  direction?: DesignBriefSlideDirection,
) {
  // A user/repository/archive image is evidence or an explicitly assigned
  // project asset. Never replace any existing image with a stock web result.
  if (slide.visual.image) return false;
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

export function shouldGenerateForSlideImage(
  slide: PresentationDocument["slides"][number],
  direction?: DesignBriefSlideDirection,
) {
  return Boolean(
    isAitunnelImageProviderEnabled()
      && !slide.visual.image
      && direction?.imageStrategy === "generated_illustration"
      && cleanText(direction.visualPrompt),
  );
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

export function chooseImageCandidate(
  candidates: ImageCandidate[],
  usedUrls = new Set<string>(),
  usedDomains = new Set<string>(),
  context: ImageCandidateContext = {},
) {
  const ranked = rankImageCandidates(candidates, context);
  for (const candidate of ranked) {
    const url = normalizeUrl(candidate.url);
    const domain = url ? new URL(url).hostname.replace(/^www\./, "") : "";
    if (!url || usedUrls.has(url) || (domain && usedDomains.has(domain))) {
      continue;
    }

    usedUrls.add(url);
    if (domain) usedDomains.add(domain);
    return { ...candidate, url };
  }

  for (const candidate of ranked) {
    const url = normalizeUrl(candidate.url);
    if (!url || usedUrls.has(url)) {
      continue;
    }

    usedUrls.add(url);
    return { ...candidate, url };
  }

  return null;
}

function rankImageCandidates(candidates: ImageCandidate[], context: ImageCandidateContext) {
  if (!cleanText(context.query || context.slideTitle || context.projectTitle)) return candidates;
  return candidates
    .map((candidate, index) => ({ candidate, index, score: imageCandidateRelevance(candidate, context) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.candidate);
}

function imageCandidateRelevance(candidate: ImageCandidate, context: ImageCandidateContext) {
  const queryText = [context.query, context.slideTitle, context.projectTitle].map(cleanText).filter(Boolean).join(" ");
  const candidateText = [candidate.description, candidate.sourceTitle, safeDecodedUrl(candidate.url)].map(cleanText).filter(Boolean).join(" ");
  const queryTokens = meaningfulImageTokens(queryText);
  const candidateTokens = new Set(meaningfulImageTokens(candidateText));
  const brandTokens = [...new Set(
    [context.projectTitle, context.query]
      .map(cleanText)
      .join(" ")
      .match(/\b[A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9-]{1,11}\b/g) || [],
  )]
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !GENERIC_BRAND_TOKENS.has(token));
  const brandMatches = brandTokens.filter((token) => candidateTokens.has(token)).length;
  const tokenMatches = queryTokens.filter((token) => candidateTokens.has(token)).length;
  if (brandTokens.length && brandMatches === 0) return 0;
  const anchorTokens = specificImageTokens([context.slideTitle, context.query].map(cleanText).join(" "));
  const anchorMatches = anchorTokens.filter((token) => candidateTokens.has(token)).length;
  const requiresExactAnchor = anchorTokens.some((token) => /\d/.test(token));
  if (requiresExactAnchor && anchorMatches === 0) return 0;
  const hasSourceMetadata = Boolean(cleanText(candidate.sourceTitle) || cleanText(candidate.sourceUrl));
  const unsuitableFormat = /\.(?:html?|svg)(?:$|[?#])/i.test(candidate.url);
  const historicalRequest = /\b(?:historical|first generation|vintage|classic|19\d{2})\b|(?:истори|поколени|архив)/iu.test(queryText);
  const modernConflict = historicalRequest && /\b(?:20(?:1[8-9]|2\d)|modern|latest|new model)\b|(?:современ|новейш)/iu.test(candidateText);
  const confirmsHistoricalAnchor = /\b(?:historical|first generation|vintage|classic|archive|19\d{2})\b|(?:истори|поколени|архив)/iu.test(candidateText);
  if (modernConflict && !confirmsHistoricalAnchor) return 0;
  return brandMatches * 12 + anchorMatches * 7 + tokenMatches * 3 + (hasSourceMetadata ? 2 : 0) - (unsuitableFormat ? 12 : 0) - (modernConflict ? 18 : 0);
}

function specificImageTokens(value: string) {
  return unique(
    cleanText(value)
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 3 && !IMAGE_RELEVANCE_STOP_WORDS.has(token) && !GENERIC_IMAGE_QUERY_TOKENS.has(token))
      .filter((token) => /\d/.test(token) || token.length >= 5),
  );
}

const GENERIC_IMAGE_QUERY_TOKENS = new Set([
  "slide", "topic", "study", "student", "students", "university", "education", "classroom", "context", "explain", "explains",
  "model", "history", "historical", "photograph", "documentary", "picture", "image", "photo", "presentation",
  "слайд", "тема", "учебный", "студент", "университет", "образование", "контекст", "объяснение", "модель", "история", "фотография",
]);

export function sanitizeImageQuery(value: string) {
  const tokens = cleanText(value)
    .replace(/\b(?:presentation|educational|image|picture|photo)\s+(?:image|picture|photo)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const query = unique(tokens).slice(0, 18).join(" ");
  return shorten(query, Math.min(TAVILY_QUERY_SAFE_LENGTH, 220)).slice(0, TAVILY_QUERY_MAX_LENGTH).trim();
}

function meaningfulImageTokens(value: string) {
  return [...new Set(
    cleanText(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2 && !IMAGE_RELEVANCE_STOP_WORDS.has(token)),
  )];
}

const IMAGE_RELEVANCE_STOP_WORDS = new Set([
  ...GENERIC_VISUAL_PROMPT_WORDS,
  "official", "documentary", "photograph", "authentic", "scene", "showing", "from", "with", "that", "this",
  "для", "как", "или", "при", "это", "этот", "эта", "эти", "сцена", "показывает", "фотография",
]);

const GENERIC_BRAND_TOKENS = new Set(["ai", "api", "ui", "ux", "it", "vr", "ar", "ml", "llm"]);

function safeDecodedUrl(value: string) {
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/[\/_-]+/g, " "));
  } catch {
    return "";
  }
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

  const usage = currentUsageContext();
  await recordCostEvent({
    idempotencyKey: crypto.createHash("sha256").update(`${usage?.generationJobId || usage?.queueJobId || "unknown"}:tavily:image:${query}`).digest("hex"),
    category: "image_search",
    provider: "tavily",
    quantity: "1",
    unit: "api_credit",
    unitPrice: process.env.TAVILY_CREDIT_PRICE_USD,
    currency: "USD",
    measurement: "calculated",
  });

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
    let bestMetadata: Metadata | null = null;

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
  const subject = cleanText(description);
  const exactTitle = cleanText(title);
  return shorten(subject ? `${exactTitle}: ${subject}` : `Иллюстрация к слайду: ${exactTitle}`, 180);
}

function safeVisualFallback(
  direction: DesignBriefSlideDirection | undefined,
  slide: PresentationDocument["slides"][number],
) {
  if (!direction || !isExternalVisualStrategy(direction.imageStrategy) || slide.visual.image) return undefined;
  const diagramFriendly = direction.visualRole === "compare" || direction.visualRole === "sequence" || direction.visualRole === "evidence" || direction.visualRole === "explain" || direction.visualRole === "context";
  return {
    ...direction,
    layoutIntent: diagramFriendly ? "diagram" as const : "statement" as const,
    imageStrategy: diagramFriendly ? "diagram" as const : "none" as const,
    sceneTextMode: diagramFriendly ? "visual_labels" as const : "talk_sentences" as const,
    visualPrompt: diagramFriendly
      ? `Explanatory diagram for ${cleanText(slide.title)}`
      : `Text-led conclusion for ${cleanText(slide.title)}`,
  };
}

function fallbackSlideForMissingPhoto(
  slide: PresentationDocument["slides"][number],
  direction?: DesignBriefSlideDirection,
) {
  if (!isExternalVisualStrategy(direction?.imageStrategy) || slide.visual.image) return slide;
  const items = slide.bullets
    .map((text, index) => ({ label: `${index + 1}`, text: cleanText(text) }))
    .filter((item) => item.text)
    .slice(0, 5);
  // A failed photo lookup must not leave a decorative empty layout behind.
  // Only promote the slide to a diagram when the generated slide already
  // contains enough ordered material to explain a process.
  if (items.length >= 3) {
    return {
      ...slide,
      layout: "process" as const,
      visual: {
        ...slide.visual,
        type: "process_diagram" as const,
        title: cleanText(slide.title),
        description: cleanText(slide.thesis),
        items,
      },
    };
  }
  return { ...slide, layout: "statement" as const };
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

  return Boolean(
    dependencies.searchImages
      || dependencies.generateImage
      || process.env.TAVILY_API_KEY?.trim()
      || (presentationImageProvider() === "aitunnel" && process.env.AITUNNEL_API_KEY?.trim()),
  );
}

function isExternalVisualStrategy(value: DesignBriefSlideDirection["imageStrategy"] | undefined) {
  return value === "real_photo" || value === "generated_illustration";
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
