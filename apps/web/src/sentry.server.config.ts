import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 0,
    sendDefaultPii: false,
    beforeSend: redactSentryEvent,
  });
}

function redactSentryEvent(event: Sentry.ErrorEvent) {
  return redactEventStrings(event);
}

function redactEventStrings<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (typeof value === "string") {
    return value
      .replace(/\b(sk-[A-Za-z0-9_-]+|AQVN[A-Za-z0-9_-]+)\b/g, "[redacted]")
      .slice(0, 1000) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactEventStrings(item, depth + 1)) as T;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (/prompt|content|api[-_]?key|token|secret|password/i.test(key)) {
        (value as Record<string, unknown>)[key] = "[redacted]";
      } else {
        (value as Record<string, unknown>)[key] = redactEventStrings(nested, depth + 1);
      }
    }
  }
  return value;
}
