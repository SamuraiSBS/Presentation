"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import * as Sentry from "@sentry/nextjs";

export function CheckoutButton({ plan }: { plan: "student" | "pro" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, idempotencyKey: checkoutIdempotencyKey(plan) }),
      });
      const result = await response.json().catch(() => null) as { url?: unknown; message?: unknown } | null;
      if (!response.ok || typeof result?.url !== "string") {
        throw new Error(typeof result?.message === "string" ? result.message : "Checkout session was not created");
      }

      window.location.assign(result.url);
    } catch (cause) {
      Sentry.addBreadcrumb({
        category: "billing.checkout",
        level: "error",
        message: "Checkout session creation failed",
        data: { plan, reason: cause instanceof Error ? cause.message : "unknown" },
      });
      setError("Не удалось открыть страницу оплаты. Проверьте подключение и повторите попытку.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="button" type="button" onClick={checkout} disabled={busy}>
        {busy ? <><LoaderCircle className="spin" aria-hidden="true" size={18} />Открываем оплату...</> : error ? "Повторить попытку" : "Выбрать план"}
      </button>
      {error ? <p role="alert" aria-live="assertive">{error}</p> : null}
    </div>
  );
}

function checkoutIdempotencyKey(plan: "student" | "pro") {
  const storageKey = `studydeck:checkout:idempotency:${plan}`;
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;

  const key = `checkout:${plan}:${crypto.randomUUID()}`;
  window.sessionStorage.setItem(storageKey, key);
  return key;
}
