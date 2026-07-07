import { afterEach, describe, expect, it } from "vitest";
import { errorLogFields, redactLogString, tracingEnabled, withTraceSpan } from "./observability.js";

describe("worker observability redaction", () => {
  afterEach(() => {
    delete process.env.OTEL_TRACING_ENABLED;
  });

  it("redacts likely provider tokens from log strings", () => {
    expect(redactLogString("provider rejected sk-secret123456 and AQVNabcdef123456")).toBe(
      "provider rejected [redacted] and [redacted]",
    );
  });

  it("formats errors without stack traces or raw secrets", () => {
    const fields = errorLogFields(new TypeError("bad token sk-secret123456"));

    expect(fields).toEqual({
      errorName: "TypeError",
      errorMessage: "bad token [redacted]",
    });
    expect(fields).not.toHaveProperty("stack");
  });

  it("keeps tracing disabled by default", async () => {
    let called = false;

    const result = await withTraceSpan("generation.research", {
      "studydeck.project_id": "project-1",
      "studydeck.stage": "research",
      "studydeck.provider": "tavily",
    }, async () => {
      called = true;
      return "ok";
    });

    expect(tracingEnabled()).toBe(false);
    expect(called).toBe(true);
    expect(result).toBe("ok");
  });

  it("recognizes explicit tracing opt-in values", () => {
    process.env.OTEL_TRACING_ENABLED = "true";

    expect(tracingEnabled()).toBe(true);
  });
});
