import * as Sentry from "@sentry/nextjs";
import { assertProductionConfiguration } from "@studydeck/shared";

export async function register() {
  assertProductionConfiguration();
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
