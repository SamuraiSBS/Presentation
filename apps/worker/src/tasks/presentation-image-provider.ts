export type PresentationImageProvider = "tavily" | "aitunnel";

/**
 * Image provider selection is deliberately independent from WEB_SEARCH_PROVIDER.
 * Tavily remains the backwards-compatible default for real-photo enrichment;
 * AITUNNEL is only selected when this switch is set explicitly.
 */
export function presentationImageProvider(env: Record<string, string | undefined> = process.env): PresentationImageProvider {
  return env.PRESENTATION_IMAGE_PROVIDER?.trim().toLowerCase() === "aitunnel" ? "aitunnel" : "tavily";
}

export function isAitunnelImageProviderEnabled(env: Record<string, string | undefined> = process.env) {
  return presentationImageProvider(env) === "aitunnel";
}
