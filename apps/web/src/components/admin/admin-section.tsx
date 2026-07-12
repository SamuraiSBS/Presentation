"use client";

import { useSearchParams } from "next/navigation";
import { useAdminAction, useAdminSection } from "@/lib/admin-queries";
import { AdminEmpty, AdminError, AdminLoading, DateTime, Money } from "./admin-states";

const meta: Record<string, { title: string; body: string }> = {
  revenue: { title: "Выручка и подписки", body: "Только подтверждённые Stripe-транзакции; checkout completion не считается выручкой." },
  costs: { title: "Расходы", body: "AI usage, Tavily, изображения, storage, export и комиссии. Неизвестные цены не подменяются нулём." },
  generations: { title: "Генерации и очереди", body: "Состояние narration и presentation jobs, безопасный повтор и cooperative cancel." },
  errors: { title: "Ошибки", body: "Сгруппированные безопасные operational events. Raw stack остаётся в Sentry." },
  logs: { title: "Технические события", body: "Только значимые redacted-события, а не полный stdout." },
  audit: { title: "Действия администратора", body: "Неизменяемая история опасных действий и их причин." },
  alerts: { title: "Уведомления", body: "Production-only Telegram alerts без PII, промптов и секретов." },
};

export function AdminSection({ section }: { section: keyof typeof meta }) {
  const params = useSearchParams(); const search = params.toString() ? `?${params}` : ""; const query = useAdminSection(section, search); const action = useAdminAction();
  if (query.isLoading) return <AdminLoading />; if (query.error) return <AdminError error={query.error} retry={() => void query.refetch()} />; const data = query.data!;
  return <section className="admin-page"><header className="admin-page-heading"><div><h1>{meta[section].title}</h1><p>{meta[section].body}</p></div></header><SectionBody section={section} data={data} onAction={(path, body) => void action.mutateAsync({ path, body })} /></section>;
}

function SectionBody({ section, data, onAction }: { section: string; data: Record<string, unknown>; onAction: (path: string, body?: unknown) => void }) {
  if (section === "alerts") { const rules = (data.rules || []) as Array<Record<string, unknown>>; return <div className="admin-panel"><div className="admin-panel-heading"><h2>Правила</h2><span className={data.enabled ? "admin-status admin-status-ok" : "admin-status"}>{data.enabled ? "Включены" : "Отключены"}</span></div>{rules.map((rule) => <div className="admin-rule" key={String(rule.id)}><div><strong>{String(rule.label)}</strong><small>{rule.threshold ? `Порог: ${String(rule.threshold)}` : "Без отдельного порога"}</small></div><span>{rule.enabled ? "Активно" : "Не настроено"}</span></div>)}</div>; }
  if (section === "costs") { const summary = data.summary as Record<string, unknown>; const ai = (data.ai || []) as Array<Record<string, unknown>>; const other = (data.other || []) as Array<Record<string, unknown>>; return <><div className="admin-inline-summary"><div><span>Всего по текущему курсу</span><strong><Money value={String(summary.totalRubCurrent || 0)} /></strong></div><div><span>Неизвестная цена / usage</span><strong>{String(summary.unknownCount || 0)}</strong></div></div><RecordTable items={[...ai, ...other]} section={section} /></>; }
  if (section === "revenue") { const totals = data.totals as Record<string, unknown>; return <><div className="admin-inline-summary"><div><span>Gross</span><strong><Money value={String(totals.grossRub || 0)} /></strong></div><div><span>Комиссии</span><strong><Money value={String(totals.feesRub || 0)} /></strong></div><div><span>Net</span><strong><Money value={String(totals.netRub || 0)} /></strong></div></div><RecordTable items={(data.items || []) as Array<Record<string, unknown>>} section={section} /></>; }
  const items = (data.items || []) as Array<Record<string, unknown>>; return <RecordTable items={items} section={section} onAction={onAction} />;
}

function RecordTable({ items, section, onAction }: { items: Array<Record<string, unknown>>; section: string; onAction?: (path: string, body?: unknown) => void }) {
  if (!items.length) return <AdminEmpty />;
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Объект</th><th>Статус / тип</th><th>Контекст</th><th>Сумма</th><th>Время</th>{section === "generations" ? <th>Действия</th> : null}</tr></thead><tbody>{items.map((item) => <tr key={String(item.id)}><td><strong>{String(item.projectTitle || item.message || item.action || item.provider || item.id)}</strong><small>{String(item.error || item.fingerprint || item.targetId || "")}</small></td><td>{String(item.status || item.severity || item.type || item.category || item.measurement || "—")}</td><td>{String(item.model || item.service || item.userId || item.currency || "—")}</td><td>{item.rubCostAtEvent != null || item.netRubAtEvent != null ? <Money value={String(item.rubCostAtEvent || item.netRubAtEvent)} /> : <span className="admin-muted">—</span>}</td><td><DateTime value={String(item.updatedAt || item.occurredAt || item.createdAt || "")} /></td>{section === "generations" ? <td><div className="admin-row-actions">{item.status === "failed" ? <button className="ghost" onClick={() => onAction?.(`generations/${String(item.id)}/retry`)}>Повторить</button> : null}{item.status === "queued" || item.status === "active" ? <button className="admin-danger-button" onClick={() => { const reason = window.prompt("Причина отмены"); if (reason) onAction?.(`generations/${String(item.id)}/cancel`, { reason }); }}>Отменить</button> : null}</div></td> : null}</tr>)}</tbody></table></div>;
}
