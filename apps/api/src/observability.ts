import * as Sentry from "@sentry/node";
import pino from "pino";

const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]+|AQVN[A-Za-z0-9_-]+)\b/g;
const SENSITIVE_KEY_PATTERN = /authorization|cookie|api[-_]?key|token|secret|password|prompt|content/i;

export const logger = pino({
  name: "studydeck-api",
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "studydeck-api" },
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

export function initSentry(serviceName = "studydeck-api") {
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

export function captureApiError(error: unknown, context: { method?: string; path?: string; statusCode?: number }) {
  logger.error({
    ...context,
    ...errorLogFields(error),
  }, "api request failed");

  if (!initialized) return;

  Sentry.withScope((scope) => {
    scope.setTag("service", "studydeck-api");
    if (context.method) scope.setTag("http.method", context.method);
    if (context.statusCode) scope.setTag("http.status_code", String(context.statusCode));
    if (context.path) scope.setContext("request", { path: context.path });
    scope.setTag("error.class", error instanceof Error ? error.name : typeof error);
    Sentry.captureException(error);
  });
}
