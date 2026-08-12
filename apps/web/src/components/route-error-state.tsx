"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function RouteErrorState({
  error,
  retry,
  scope,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  scope: "editor" | "export";
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { route_error_boundary: scope } });
  }, [error, scope]);

  const editor = scope === "editor";
  return (
    <main className="page route-error-page">
      <section className="panel route-error-state" role="alert" aria-labelledby="route-error-title">
        <span className="route-error-icon"><AlertTriangle aria-hidden="true" /></span>
        <div>
          <p className="route-error-kicker">{editor ? "Редактор временно недоступен" : "Экспорт временно недоступен"}</p>
          <h1 id="route-error-title">Не удалось открыть этот этап работы</h1>
          <p className="muted">
            {editor
              ? "Сохранённая версия презентации остаётся в проекте. Восстановите подключение и повторите загрузку."
              : "Уже запущенные сборки продолжаются в фоне. После восстановления подключения обновите этот экран."}
          </p>
          {error.digest ? <p className="route-error-reference">Код обращения: {error.digest}</p> : null}
        </div>
        <div className="route-error-actions">
          <button className="button" type="button" onClick={retry}>
            <RefreshCw aria-hidden="true" /> Повторить загрузку
          </button>
          <Link className="ghost" href="/projects">К списку презентаций</Link>
        </div>
      </section>
    </main>
  );
}
