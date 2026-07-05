"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

export function CheckoutButton({ plan }: { plan: "student" | "pro" }) {
  const [busy, setBusy] = useState(false);

  async function checkout() {
    setBusy(true);
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const result = await response.json();
    if (result.url) window.location.href = result.url;
    setBusy(false);
  }

  return (
    <button className="button" type="button" onClick={checkout} disabled={busy}>
      {busy ? <><LoaderCircle className="spin" aria-hidden="true" size={18} />Открываем оплату...</> : "Выбрать план"}
    </button>
  );
}
