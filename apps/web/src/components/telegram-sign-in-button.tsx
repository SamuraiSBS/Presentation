"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { signIn } from "next-auth/react";

export function TelegramSignInButton({
  callbackUrl,
  disabled = false,
}: {
  callbackUrl: string;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignIn() {
    setLoading(true);
    setError("");

    try {
      await signIn("telegram", { callbackUrl });
    } catch {
      setError("Не получилось открыть вход через Telegram. Попробуй ещё раз.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        className="button"
        type="button"
        disabled={disabled || loading}
        onClick={handleSignIn}
      >
        <Send aria-hidden="true" size={18} />
        {loading ? "Открываем Telegram…" : "Войти через Telegram"}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}
