import { describe, expect, it } from "vitest";
import { errorLogFields, redactLogString } from "./observability.js";

describe("worker observability redaction", () => {
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
});
