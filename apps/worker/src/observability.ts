import * as Sentry from "@sentry/node";
import { context, propagation, SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import pino from "pino";
import crypto from "node:crypto";
import { getPrisma } from "./prisma.js";

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
let tracingInitialized = false;
let tracingSdk: NodeSDK | undefined;

export type TraceCarrier = Record<string, string>;
type TraceAttributes = Record<string, string | number | boolean | undefined | null>;

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

export function initTracing(serviceName = "studydeck-worker") {
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

export async function shutdownObservability() {
  const results = await Promise.allSettled([
    tracingSdk?.shutdown() ?? Promise.resolve(),
    initialized ? Sentry.close(2_000) : Promise.resolve(),
  ]);
  tracingSdk = undefined;
  tracingInitialized = false;
  initialized = false;
  for (const result of results) {
    if (result.status === "rejected") {
      logger.warn({ ...errorLogFields(result.reason) }, "observability shutdown failed");
    }
  }
}

export async function withTraceSpan<T>(
  name: string,
  attributes: TraceAttributes,
  fn: () => Promise<T>,
  carrier?: TraceCarrier,
): Promise<T> {
  if (!tracingEnabled()) return fn();

  const tracer = trace.getTracer("studydeck-worker");
  const parentContext = carrier ? propagation.extract(context.active(), carrier) : context.active();
  const startedAt = Date.now();
  return tracer.startActiveSpan(name, { attributes: safeTraceAttributes(attributes) }, parentContext, async (span) => {
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

  const message = redactLogString(error instanceof Error ? error.message : String(error || "Worker operation failed"));
  const errorClass = error instanceof Error ? error.name : typeof error;
  const fingerprint = crypto.createHash("sha256").update(`worker:${operation}:${context.stage || "unknown"}:${errorClass}:${message.slice(0, 120)}`).digest("hex");
  void getPrisma().operationalEvent.create({ data: {
    service: "worker",
    severity: "error",
    category: `${operation}_error`,
    operation,
    stage: context.stage,
    projectId: context.projectId,
    jobId: context.jobId ? String(context.jobId) : undefined,
    exportId: context.exportId,
    message,
    errorClass,
    fingerprint,
    occurredAt: new Date(),
    expiresAt: new Date(Date.now() + 90 * 86_400_000),
  } }).catch((persistError) => logger.warn({ ...errorLogFields(persistError) }, "operational event could not be persisted"));

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
