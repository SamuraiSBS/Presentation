import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { captureProductAnalytics, type ProductAnalyticsEvent, type ProductAnalyticsProperties } from "@studydeck/shared";

@Injectable()
export class ProductAnalyticsService {
  constructor(private readonly config: ConfigService) {}

  capture(userId: string, event: ProductAnalyticsEvent, properties?: ProductAnalyticsProperties) {
    // Analytics is observational only. Do not make a request path, queue, or
    // payment webhook dependent on an external analytics endpoint.
    return captureProductAnalytics({
      apiKey: this.config.get<string>("POSTHOG_API_KEY"),
      host: this.config.get<string>("POSTHOG_HOST"),
      distinctId: userId,
      event,
      properties,
    });
  }
}
