type EnvLike = Record<string, string | undefined>;

export const AITUNNEL_DEFAULT_IMAGE_MODEL = "gpt-5.6-luna";
export const AITUNNEL_DEFAULT_IMAGE_SIZE = "1536x1024";
export const AITUNNEL_DEFAULT_IMAGE_QUALITY = "low";
export const AITUNNEL_DEFAULT_IMAGE_OUTPUT_FORMAT = "jpeg";
export const AITUNNEL_DEFAULT_CHAT_SVG_MAX_OUTPUT_TOKENS = 6000;

export type AitunnelImageConfig = {
  apiKey: string;
  baseURL: string;
  mode: "raster" | "chat_svg";
  imageModel: string;
  size: string;
  quality: "auto" | "low" | "medium" | "high";
  outputFormat: "png" | "jpeg" | "webp";
  maxOutputTokens: number;
};

export type GeneratedAitunnelImage = {
  buffer: Buffer;
  contentType: string;
  model: string;
  costRub?: string;
  providerRequestId?: string;
};

type AitunnelImageResponse = {
  id?: unknown;
  model?: unknown;
  data?: Array<{
    b64_json?: unknown;
    media_type?: unknown;
  }>;
  usage?: {
    cost_rub?: unknown;
  };
};

type AitunnelChatResponse = {
  id?: unknown;
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    cost_rub?: unknown;
  };
};

export function aitunnelImageConfig(env: EnvLike = process.env): AitunnelImageConfig | undefined {
  const apiKey = env.AITUNNEL_API_KEY?.trim();
  const configuredModel = env.AITUNNEL_IMAGE_MODEL?.trim();
  const imageModel = (configuredModel || env.AITUNNEL_NARRATION_MODEL?.trim() || AITUNNEL_DEFAULT_IMAGE_MODEL).trim();
  const requestedMode = (env.AITUNNEL_IMAGE_MODE || "auto").trim().toLowerCase();
  const mode = requestedMode === "chat_svg" || (requestedMode === "auto" && isAitunnelChatModel(imageModel))
    ? "chat_svg"
    : requestedMode === "raster" || requestedMode === "auto"
      ? "raster"
      : undefined;
  if (!apiKey || !imageModel || imageModel.toLowerCase() === "auto" || /\s/.test(imageModel) || !mode) return undefined;

  const quality = env.AITUNNEL_IMAGE_QUALITY?.trim().toLowerCase();
  const normalizedQuality = quality === "auto" || quality === "low" || quality === "medium" || quality === "high"
    ? quality
    : AITUNNEL_DEFAULT_IMAGE_QUALITY;
  const outputFormat = env.AITUNNEL_IMAGE_OUTPUT_FORMAT?.trim().toLowerCase();
  const normalizedOutputFormat = outputFormat === "png" || outputFormat === "jpeg" || outputFormat === "webp"
    ? outputFormat
    : AITUNNEL_DEFAULT_IMAGE_OUTPUT_FORMAT;
  const size = normalizeImageSize(env.AITUNNEL_IMAGE_SIZE) || AITUNNEL_DEFAULT_IMAGE_SIZE;

  return {
    apiKey,
    baseURL: (env.AITUNNEL_BASE_URL?.trim() || "https://api.aitunnel.ru/v1").replace(/\/+$/, ""),
    mode,
    imageModel,
    size,
    quality: normalizedQuality,
    outputFormat: normalizedOutputFormat,
    maxOutputTokens: clampNumber(Number(env.AITUNNEL_IMAGE_MAX_OUTPUT_TOKENS || AITUNNEL_DEFAULT_CHAT_SVG_MAX_OUTPUT_TOKENS), 400, 8000),
  };
}

export function normalizeAitunnelImageCost(value: unknown) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : String(value || "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text)) || Number(text) < 0) return undefined;
  return Number(text).toFixed(8);
}

export async function generateAitunnelImage(prompt: string, env: EnvLike = process.env): Promise<GeneratedAitunnelImage> {
  const config = aitunnelImageConfig(env);
  if (!config) throw new Error("AITUNNEL_API_KEY and a valid AITUNNEL_IMAGE_MODEL are required");

  if (config.mode === "chat_svg") return generateAitunnelSvgImage(prompt, config);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), imageTimeoutMs(env, "raster"));
  try {
    const response = await fetch(`${config.baseURL}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.imageModel,
        prompt: prompt.trim(),
        n: 1,
        size: config.size,
        quality: config.quality,
        output_format: config.outputFormat,
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`AITunnel image generation failed: ${response.status} ${responseText.slice(0, 500)}`);
    }

    let payload: AitunnelImageResponse;
    try {
      payload = JSON.parse(responseText) as AitunnelImageResponse;
    } catch {
      throw new Error("AITunnel image generation returned invalid JSON");
    }

    const item = payload.data?.[0];
    const base64 = typeof item?.b64_json === "string" ? item.b64_json.trim() : "";
    if (!base64) throw new Error("AITunnel image generation returned no base64 image");
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) throw new Error("AITunnel image generation returned an empty image");

    const contentType = imageContentType(item?.media_type, config.outputFormat);
    return {
      buffer,
      contentType,
      model: typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : config.imageModel,
      costRub: normalizeAitunnelImageCost(payload.usage?.cost_rub),
      providerRequestId: typeof payload.id === "string" ? payload.id : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateAitunnelSvgImage(prompt: string, config: AitunnelImageConfig): Promise<GeneratedAitunnelImage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), imageTimeoutMs(process.env, "chat_svg"));
  try {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.imageModel,
        messages: [
          {
            role: "system",
            content: "Return only one self-contained SVG illustration. Use a 16:9 viewBox, simple geometric shapes and gradients, no external resources, no text, no logos, no scripts, no foreignObject, no event handlers, and no embedded raster data.",
          },
          {
            role: "user",
            content: `${prompt}\nCreate a polished visual illustration rather than an explanation. The SVG must be valid XML and fit a 1200x675 presentation canvas.`,
          },
        ],
        max_tokens: config.maxOutputTokens,
        reasoning_effort: "minimal",
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`AITunnel GPT-5.6 image illustration failed: ${response.status} ${responseText.slice(0, 500)}`);
    }

    let payload: AitunnelChatResponse;
    try {
      payload = JSON.parse(responseText) as AitunnelChatResponse;
    } catch {
      throw new Error("AITunnel GPT-5.6 image illustration returned invalid JSON");
    }
    const svg = extractSafeSvg(payload.choices?.[0]?.message?.content);
    if (!svg) throw new Error("AITunnel GPT-5.6 image illustration returned no safe SVG");
    return {
      buffer: Buffer.from(svg, "utf8"),
      contentType: "image/svg+xml",
      model: typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : config.imageModel,
      costRub: normalizeAitunnelImageCost(payload.usage?.cost_rub),
      providerRequestId: typeof payload.id === "string" ? payload.id : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractSafeSvg(value: unknown) {
  const text = chatText(value);
  const withoutFence = text.replace(/```(?:xml|svg)?/gi, "").replace(/```/g, "").trim();
  const start = withoutFence.indexOf("<svg");
  const end = withoutFence.lastIndexOf("</svg>");
  if (start < 0 || end <= start) return "";
  const svg = withoutFence.slice(start, end + "</svg>".length).trim();
  if (svg.length > 250_000 || /<\/?(?:script|foreignObject)\b|\bon[a-z]+\s*=|javascript:|data:(?!image\/)/i.test(svg)) return "";
  return svg;
}

function chatText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(chatText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  return [item.text, item.value, item.content, item.output_text].map(chatText).find(Boolean) || "";
}

function normalizeImageSize(value: string | undefined) {
  const text = value?.trim().toLowerCase();
  if (text === "auto" || (text && /^\d{3,5}x\d{3,5}$/.test(text))) return text;
  return undefined;
}

function imageContentType(value: unknown, outputFormat: AitunnelImageConfig["outputFormat"]) {
  const contentType = String(value || "").trim().toLowerCase().split(";", 1)[0];
  if (contentType === "image/png" || contentType === "image/jpeg" || contentType === "image/webp") return contentType;
  return outputFormat === "png" ? "image/png" : outputFormat === "webp" ? "image/webp" : "image/jpeg";
}

function imageTimeoutMs(env: EnvLike, mode: AitunnelImageConfig["mode"]) {
  const fallback = mode === "chat_svg" ? 120_000 : 30_000;
  const configured = env.AITUNNEL_IMAGE_TIMEOUT_MS || (mode === "raster" ? env.PRESENTATION_IMAGE_TIMEOUT_MS : "") || fallback;
  const value = Number(configured);
  return Number.isFinite(value) ? Math.min(Math.max(value, 5_000), 180_000) : fallback;
}

function isAitunnelChatModel(model: string) {
  return /^gpt-5\.6-(?:luna|terra)$/i.test(model.trim());
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
