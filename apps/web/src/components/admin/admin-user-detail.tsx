"use client";

import { useState } from "react";
import { useAdminAction, useAdminUser } from "@/lib/admin-queries";
import { AdminEmpty, AdminError, AdminLoading, DateTime, Money } from "./admin-states";

const tabs = ["Сводка", "Проекты", "Генерации", "Расходы", "Оплаты", "Ошибки", "Активность", "Аудит"] as const;

export function AdminUserDetail({ id }: { id: string }) {
  const query = useAdminUser(id);
  const action = useAdminAction();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Сводка");
  const [notice, setNotice] = useState("");
  if (query.isLoading) return <AdminLoading />;
  if (query.error) return <AdminError error={query.error} retry={() => void query.refetch()} />;
  const data = query.data!; const user = data.user;
  async function run(path: string, method: string, body?: unknown) { setNotice(""); try { const result = await action.mutateAsync({ path, method, body }); setNotice(result.message); } catch (error) { setNotice(error instanceof Error ? error.message : "Действие не выполнено"); } }
  function reasonAction(kind: "block" | "plan") { const reason = window.prompt(kind === "block" ? "Причина блокировки (обязательна)" : "Причина ручного тарифа (обязательна)"); if (!reason?.trim()) return; if (kind === "block") void run(`users/${id}/block`, "POST", { reason }); else { const plan = window.prompt("Тариф: free, student или pro", "pro"); if (plan && ["free", "student", "pro"].includes(plan)) void run(`users/${id}/plan-override`, "PUT", { reason, plan }); } }
  return <section className="admin-page"><header className="admin-profile-header"><div className="admin-profile-identity"><span className="admin-avatar admin-avatar-large">{user.name?.slice(0, 1) || "?"}</span><div><a href="/admin/users">← Пользователи</a><h1>{user.name || "Без имени"}</h1><p>@{user.telegramUsername || "—"} · {user.telegramId || user.id}</p></div></div><div className="admin-profile-actions">{user.blockedAt ? <button className="ghost" onClick={() => void run(`users/${id}/unblock`, "POST")}>Разблокировать</button> : <button className="admin-danger-button" onClick={() => reasonAction("block")}>Заблокировать</button>}<button className="ghost" onClick={() => reasonAction("plan")}>Назначить тариф</button>{user.planOverride ? <button className="ghost" onClick={() => void run(`users/${id}/plan-override`, "DELETE")}>Снять override</button> : null}</div></header>
    {notice ? <div className="admin-notice" role="status">{notice}</div> : null}<div className="admin-privacy-note">Чувствительное содержимое скрыто: промпты, тексты источников и presentation JSON не передаются в admin API.</div>
    <div className="admin-tabs" role="tablist">{tabs.map((item) => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === "Сводка" ? <div className="admin-detail-grid"><section className="admin-panel"><h2>Профиль</h2><dl className="admin-definition-list"><div><dt>Тариф</dt><dd>{user.effectivePlanCode}</dd></div><div><dt>Подписка</dt><dd>{user.subscriptionStatus || "Нет"}</dd></div><div><dt>Регистрация</dt><dd><DateTime value={user.createdAt} /></dd></div><div><dt>Последняя активность</dt><dd><DateTime value={user.lastSeenAt} /></dd></div><div><dt>Блокировка</dt><dd>{user.blockReason || "Нет"}</dd></div></dl></section><section className="admin-panel"><h2>Итоги</h2><dl className="admin-definition-list"><div><dt>Проекты</dt><dd>{user.projects}</dd></div><div><dt>Слайды</dt><dd>{data.totals.slides}</dd></div><div><dt>Генерации</dt><dd>{user.generations}</dd></div><div><dt>Расходы</dt><dd><Money value={user.totalCostRub} unknown={user.totalCostRub === null} /></dd></div><div><dt>Выручка</dt><dd><Money value={user.revenueRub} /></dd></div></dl></section></div> : <DetailTab tab={tab} data={data} />}
  </section>;
}

function DetailTab({ tab, data }: { tab: (typeof tabs)[number]; data: ReturnType<typeof useAdminUser>["data"] extends infer T ? NonNullable<T> : never }) {
  const items = tab === "Проекты" ? data.projects : tab === "Генерации" ? data.generations : tab === "Расходы" ? data.costs : tab === "Оплаты" ? data.payments : tab === "Ошибки" ? data.errors : tab === "Активность" ? data.activity : data.audit;
  if (!items.length) return <AdminEmpty />;
  return <div className="admin-record-list">{items.map((raw) => { const item = raw as unknown as Record<string, unknown>; const id = String(item.id); return <article key={id}><div><strong>{String(item.title || item.projectTitle || item.type || item.action || item.category || item.message || id)}</strong><small>{String(item.status || item.provider || item.severity || "")}</small></div><DateTime value={String(item.updatedAt || item.occurredAt || item.createdAt || "")} /></article>; })}</div>;
}
