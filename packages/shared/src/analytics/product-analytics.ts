import { z } from "zod";

/**
 * Deliberately small, product-facing vocabulary. Keep operational logs and
 * product analytics separate: this list is safe to expose to the analytics
 * destination and intentionally has no free-form text field.
 */
export const productAnalyticsEventSchema = z.enum([
  "landing_viewed",
  "login_completed",
  "project_created",
  "sources_added",
  "sources_reviewed",
  "script_approved",
  "generation_requested",
  "generation_completed",
  "generation_failed",
  "editor_opened",
  "export_requested",
  "export_completed",
  "export_failed",
  "export_downloaded",
  "checkout_started",
  "paid_conversion",
  "subscription_churned",
]);

export type ProductAnalyticsEvent = z.infer<typeof productAnalyticsEventSchema>;

export type ProductAnalyticsProperties = Record<string, boolean | number | string | readonly string[] | null>;

export type ProductAnalyticsCapture = {
  apiKey?: string;
  host?: string;
  distinctId: string;
  event: ProductAnalyticsEvent;
  properties?: ProductAnalyticsProperties;
};

const forbiddenPropertyName = /(prompt|text|content|title|name|email|token|secret|password|url|excerpt|file)/i;
const scalarValue = z.union([z.boolean(), z.number().finite(), z.string().max(80), z.null()]);
const propertyValue = z.union([scalarValue, z.array(z.string().max(40)).max(12)]);

/**
 * Drops anything that could accidentally become presentation/source content or
 * a credential. Keep this at the shared boundary so browser, API and worker
 * have the exact same privacy guard.
 */
export function safeProductAnalyticsProperties(properties: ProductAnalyticsProperties = {}) {
  return Object.fromEntries(Object.entries(properties).flatMap(([key, value]) => {
    if (forbiddenPropertyName.test(key)) return [];
    const parsed = propertyValue.safeParse(value);
    return parsed.success ? [[key, parsed.data]] : [];
  }));
}

/**
 * Sends an event using PostHog's dependency-free Capture API. A missing key
 * intentionally makes analytics a no-op, so local development and outages do
 * not affect user flows.
 */
export async function captureProductAnalytics(input: ProductAnalyticsCapture) {
  const apiKey = input.apiKey?.trim();
  if (!apiKey || !input.distinctId) return false;

  const host = (input.host?.trim() || "https://us.i.posthog.com").replace(/\/$/, "");
  try {
    const response = await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        api_key: apiKey,
        event: input.event,
        properties: {
          distinct_id: input.distinctId,
          ...safeProductAnalyticsProperties(input.properties),
        },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Merge the browser's pre-login id into the authenticated product identity. */
export async function identifyProductAnalytics(input: { apiKey?: string; host?: string; anonymousId: string; distinctId: string }) {
  const apiKey = input.apiKey?.trim();
  if (!apiKey || !input.anonymousId || !input.distinctId || input.anonymousId === input.distinctId) return false;
  const host = (input.host?.trim() || "https://us.i.posthog.com").replace(/\/$/, "");
  try {
    const response = await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        api_key: apiKey,
        event: "$identify",
        properties: { distinct_id: input.distinctId, $anon_distinct_id: input.anonymousId },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
