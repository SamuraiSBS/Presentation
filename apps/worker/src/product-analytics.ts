import { captureProductAnalytics, type ProductAnalyticsEvent, type ProductAnalyticsProperties } from "@studydeck/shared";

export function captureWorkerProductAnalytics(userId: string, event: ProductAnalyticsEvent, properties?: ProductAnalyticsProperties) {
  return captureProductAnalytics({
    apiKey: process.env.POSTHOG_API_KEY,
    host: process.env.POSTHOG_HOST,
    distinctId: userId,
    event,
    properties,
  });
}
