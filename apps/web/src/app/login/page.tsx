import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { TelegramSignInButton } from "@/components/telegram-sign-in-button";
import { authOptions, isTelegramAuthConfigured } from "@/lib/auth-options";

export const dynamic = "force-dynamic";

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeCallbackUrl(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (value.startsWith("/login") || value.startsWith("/api/auth")) return "/dashboard";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const callbackUrl = safeCallbackUrl(firstQueryValue(query.callbackUrl));
  const session = await getServerSession(authOptions);
  if (session?.user?.id) redirect(callbackUrl);

  const telegramConfigured = isTelegramAuthConfigured();
  const devAuthEnabled = process.env.ALLOW_DEV_AUTH === "true";
  const authError = firstQueryValue(query.error);

  return (
    <main className="page">
      <section className="panel">
        <p className="status">Личный кабинет StudyDeck</p>
        <h1 className="page-title">Войди, чтобы продолжить</h1>
        <p className="lead">
          Проекты, папки и совместные презентации будут привязаны к твоему Telegram-аккаунту.
        </p>

        {authError ? (
          <p className="form-error" role="alert">
            Telegram не подтвердил вход. Попробуй ещё раз.
          </p>
        ) : null}

        <TelegramSignInButton callbackUrl={callbackUrl} disabled={!telegramConfigured} />

        {!telegramConfigured ? (
          <p className="lead">
            Telegram-вход пока не настроен для этого окружения.
          </p>
        ) : null}

        {devAuthEnabled ? (
          <Link className="ghost" href={callbackUrl}>
            Продолжить в локальном режиме
          </Link>
        ) : null}
      </section>
    </main>
  );
}
