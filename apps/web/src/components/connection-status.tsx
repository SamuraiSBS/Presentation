"use client";

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";

export type ConnectionScope = "editor" | "export";
export type ConnectionState = "online" | "offline" | "reconnected";

export function connectionMessage(scope: ConnectionScope, state: ConnectionState) {
  if (state === "offline") {
    return scope === "editor"
      ? "Нет подключения. Новые правки остаются в этой вкладке — не закрывайте её, пока не увидите «Сохранено»."
      : "Нет подключения. Нельзя начать экспорт или скачать файл. Уже запущенная сборка продолжится на сервере.";
  }

  return scope === "editor"
    ? "Подключение восстановлено. Отправляем последние несохранённые правки."
    : "Подключение восстановлено. Обновляем статус экспорта.";
}

export function ConnectionStatus({
  scope,
  onReconnect,
}: {
  scope: ConnectionScope;
  onReconnect?: () => Promise<void> | void;
}) {
  const [state, setState] = useState<ConnectionState>("online");

  useEffect(() => {
    let resetTimer: number | undefined;
    const goOffline = () => {
      if (resetTimer) window.clearTimeout(resetTimer);
      setState("offline");
    };
    const goOnline = () => {
      setState("reconnected");
      void Promise.resolve(onReconnect?.()).finally(() => {
        resetTimer = window.setTimeout(() => setState("online"), 1800);
      });
    };

    if (!navigator.onLine) goOffline();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      if (resetTimer) window.clearTimeout(resetTimer);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [onReconnect]);

  if (state === "online") return null;
  const restored = state === "reconnected";

  return (
    <div
      className={`connection-status connection-status-${state}`}
      role={restored ? "status" : "alert"}
      aria-live="polite"
    >
      {restored ? <Wifi aria-hidden="true" /> : <CloudOff aria-hidden="true" />}
      <p>{connectionMessage(scope, state)}</p>
      {restored ? <RefreshCw className="connection-status-refresh" aria-hidden="true" /> : null}
    </div>
  );
}
