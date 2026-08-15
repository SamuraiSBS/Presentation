"use client";

import { useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import type { PaidPlanCode } from "@studydeck/shared";

export function CheckoutButton({ plan }: { plan: PaidPlanCode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  async function checkout() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, idempotencyKey: idempotencyKey.current ||= `checkout:${plan}:${crypto.randomUUID()}` }),
      });
      const result = await response.json().catch(() => null) as { url?: unknown; message?: unknown } | null;
      if (!response.ok || typeof result?.url !== "string") {
        throw new Error(typeof result?.message === "string" ? result.message : "Не удалось создать платёж");
      }

      window.location.assign(result.url);
    } catch (cause) {
      idempotencyKey.current = null;
      Sentry.addBreadcrumb({
        category: "billing.checkout",
        level: "error",
        message: "YooKassa checkout creation failed",
        data: { plan, reason: cause instanceof Error ? cause.message : "unknown" },
      });
      setError("Не удалось открыть оплату. Проверьте соединение и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="button" type="button" onClick={checkout} disabled={busy}>
        {busy ? <><LoaderCircle className="spin" aria-hidden="true" size={18} />Открываем оплату...</> : error ? "Повторить попытку" : "Выбрать тариф"}
      </button>
      {error ? <p role="alert" aria-live="assertive">{error}</p> : null}
    </div>
  );
}
