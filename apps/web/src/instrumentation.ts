import { assertProductionConfiguration } from "@studydeck/shared";

export async function register() {
  // Playwright starts a disposable local server. Loading Sentry's Node
  // instrumentation there compiles a large dependency graph before the
  // server answers its readiness probe, while it provides no useful E2E
  // signal. Production and ordinary development keep the normal setup.
  if (process.env.E2E_TEST_MODE === "true") return;

  assertProductionConfiguration();
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(
  ...args: Parameters<(typeof import("@sentry/nextjs"))["captureRequestError"]>
) {
  if (process.env.E2E_TEST_MODE === "true") return;
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(...args);
}
