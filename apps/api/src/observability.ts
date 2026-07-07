import * as Sentry from "@sentry/node";
import { context, propagation, SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
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
let tracingInitialized = false;
let tracingSdk: NodeSDK | undefined;

export type TraceCarrier = Record<string, string>;
type TraceAttributes = Record<string, string | number | boolean | undefined | null>;

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

export function initTracing(serviceName = "studydeck-api") {
  if (tracingInitialized || !tracingEnabled()) return false;

  try {
    tracingSdk = new NodeSDK({
      serviceName,
      traceExporter: new ConsoleSpanExporter(),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    tracingSdk.start();
    tracingInitialized = true;
    logger.info({ serviceName }, "opentelemetry tracing enabled");
    return true;
  } catch (error) {
    logger.warn({ ...errorLogFields(error) }, "opentelemetry tracing could not be initialized");
    return false;
  }
}

export function tracingEnabled() {
  return ["1", "true", "yes"].includes(String(process.env.OTEL_TRACING_ENABLED || "").toLowerCase());
}

export function injectTraceContext(): TraceCarrier | undefined {
  if (!tracingEnabled()) return undefined;
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return Object.keys(carrier).length ? carrier : undefined;
}

export async function withTraceSpan<T>(name: string, attributes: TraceAttributes, fn: () => Promise<T>): Promise<T> {
  if (!tracingEnabled()) return fn();

  const tracer = trace.getTracer("studydeck-api");
  const startedAt = Date.now();
  return tracer.startActiveSpan(name, { attributes: safeTraceAttributes(attributes) }, async (span) => {
    try {
      return await fn();
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.name : "UnknownError" });
      throw error;
    } finally {
      span.setAttribute("studydeck.duration_ms", Date.now() - startedAt);
      span.end();
    }
  });
}

function safeTraceAttributes(attributes: TraceAttributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, value]),
  ) as Attributes;
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
