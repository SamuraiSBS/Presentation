"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

export function SignInPanel() {
  const [email, setEmail] = useState("");

  async function handleEmail(event: FormEvent) {
    event.preventDefault();
    await signIn("email", { email, callbackUrl: "/dashboard" });
  }

  return (
    <div className="form">
      <button className="button" type="button" onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
        Войти через Google
      </button>
      {process.env.NEXT_PUBLIC_ALLOW_DEV_AUTH === "true" ? (
        <button className="ghost" type="button" onClick={() => signIn("dev", { email: "dev@studydeck.local", callbackUrl: "/dashboard" })}>
          Локальный dev-вход
        </button>
      ) : null}
      <form className="form" onSubmit={handleEmail}>
        <label className="field">
          Email
          <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <button className="ghost" type="submit">Получить ссылку для входа</button>
      </form>
    </div>
  );
}
