"use client";

import { useSearchParams } from "next/navigation";
import { useAdminOverview } from "@/lib/admin-queries";
import { AdminEmpty, AdminError, AdminLoading, DateTime, Money } from "./admin-states";

export function AdminOverview() {
  const params = useSearchParams();
  const search = params.toString() ? `?${params.toString()}` : "";
  const query = useAdminOverview(search);
  if (query.isLoading) return <AdminLoading />;
  if (query.error) return <AdminError error={query.error} retry={() => void query.refetch()} />;
  const data = query.data!;
  return <section className="admin-page">
    <header className="admin-page-heading"><div><h1>Операционный обзор</h1><p>Пользователи, экономика и проблемы сервиса за выбранный период.</p></div><span className="admin-live">Обновляется каждую минуту</span></header>
    <div className="admin-summary-grid">
      <article><h2>Пользователи</h2><strong>{data.users.total}</strong><dl><div><dt>Новые</dt><dd>{data.users.new}</dd></div><div><dt>Активные</dt><dd>{data.users.active}</dd></div></dl></article>
      <article><h2>Экономика</h2><strong><Money value={data.revenue.netRub} /></strong><dl><div><dt>Gross</dt><dd><Money value={data.revenue.grossRub} /></dd></div><div><dt>Подписки</dt><dd>{data.revenue.activeSubscriptions}</dd></div></dl></article>
      <article><h2>Расходы</h2><strong><Money value={data.costs.totalRubCurrent} /></strong><dl><div><dt>Не сверено</dt><dd>{data.costs.unknownCount}</dd></div><div><dt>Точный учёт с</dt><dd><DateTime value={data.costs.trackedSince} /></dd></div></dl></article>
      <article className={data.errors.critical ? "admin-summary-danger" : ""}><h2>Ошибки</h2><strong>{data.errors.total}</strong><dl><div><dt>Критические</dt><dd>{data.errors.critical}</dd></div><div><dt>Failure rate</dt><dd>{data.errors.generationFailureRate}%</dd></div></dl></article>
    </div>
    <div className="admin-overview-columns">
      <section className="admin-panel"><div className="admin-panel-heading"><h2>Критические события</h2><a href="/admin/errors">Все ошибки</a></div>{data.incidents.length ? <div className="admin-event-list">{data.incidents.map((item) => <article key={item.id}><span className={`admin-severity admin-severity-${item.severity}`}>{item.severity}</span><div><strong>{item.message}</strong><small>{item.service} · <DateTime value={item.occurredAt} /></small></div></article>)}</div> : <AdminEmpty title="Критических событий нет" body="За выбранный период сервис не записал критических operational events." />}</section>
      <section className="admin-panel"><div className="admin-panel-heading"><h2>Проблемные генерации</h2><a href="/admin/generations">Очередь</a></div>{data.failedGenerations.length ? <div className="admin-event-list">{data.failedGenerations.map((item) => <article key={item.id}><span className="admin-severity admin-severity-error">failed</span><div><strong>{item.projectTitle}</strong><small>{item.error || "Причина не записана"} · <DateTime value={item.updatedAt} /></small></div></article>)}</div> : <AdminEmpty title="Неуспешных генераций нет" body="За выбранный период генерации завершались успешно." />}</section>
    </div>
  </section>;
}
