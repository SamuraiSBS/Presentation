import * as Sentry from "@sentry/node";
import pino from "pino";

type CaptureContext = {
  projectId?: string;
  jobId?: string | number;
  stage?: string;
  provider?: string;
  exportId?: string;
  exportType?: string;
  queue?: string;
};

const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]+|AQVN[A-Za-z0-9_-]+)\b/g;
const SENSITIVE_KEY_PATTERN = /authorization|cookie|api[-_]?key|token|secret|password|prompt|content/i;

export const logger = pino({
  name: "studydeck-worker",
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "studydeck-worker" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers.cookie",
      "*.authorization",
      "*.apiKey",
      "*.api_key",
      "*.token",
      "*.secret",
      "*.password",
      "*.prompt",
      "*.content",
    ],
    censor: "[redacted]",
  },
});

let initialized = false;

export function initSentry(serviceName = "studydeck-worker") {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || initialized) return false;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 0,
    sendDefaultPii: false,
    initialScope: {
      tags: { service: serviceName },
    },
    beforeSend: redactSentryEvent,
  });
  initialized = true;
  return true;
}

function redactSentryEvent(event: Sentry.ErrorEvent) {
  return redactEventStrings(event);
}

function redactEventStrings<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (typeof value === "string") {
    return redactLogString(value, 1000) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactEventStrings(item, depth + 1)) as T;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        (value as Record<string, unknown>)[key] = "[redacted]";
      } else {
        (value as Record<string, unknown>)[key] = redactEventStrings(nested, depth + 1);
      }
    }
  }
  return value;
}

export function redactLogString(value: string, maxLength = 500) {
  return value.replace(SECRET_VALUE_PATTERN, "[redacted]").slice(0, maxLength);
}

export function errorLogFields(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: redactLogString(error instanceof Error ? error.message : String(error || "Unknown error")),
  };
}

export function captureGenerationError(error: unknown, context: CaptureContext) {
  captureWorkerError(error, "generation", context);
}

export function captureExportError(error: unknown, context: CaptureContext) {
  captureWorkerError(error, "export", context);
}

function captureWorkerError(error: unknown, operation: "generation" | "export", context: CaptureContext) {
  logger.error({
    operation,
    ...context,
    jobId: context.jobId ? String(context.jobId) : undefined,
    ...errorLogFields(error),
  }, "worker operation failed");

  if (!initialized) return;

  Sentry.withScope((scope) => {
    scope.setTag("service", "studydeck-worker");
    scope.setTag("operation", operation);
    scope.setTag("error.class", error instanceof Error ? error.name : typeof error);
    if (context.stage) scope.setTag("stage", context.stage);
    if (context.provider) scope.setTag("provider", context.provider);
    if (context.exportType) scope.setTag("export.type", context.exportType);
    if (context.queue) scope.setTag("queue", context.queue);

    scope.setContext("job", {
      projectId: context.projectId,
      jobId: context.jobId ? String(context.jobId) : undefined,
      exportId: context.exportId,
    });

    Sentry.captureException(error);
  });
}
