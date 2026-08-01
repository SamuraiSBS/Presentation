"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAdminUsers } from "@/lib/admin-queries";
import { AdminEmpty, AdminError, AdminLoading, DateTime, Money } from "./admin-states";

export function AdminUsers() {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const suffix = params.toString() ? `?${params}` : "";
  const query = useAdminUsers(suffix);
  if (query.isLoading) return <AdminLoading />;
  if (query.error) return <AdminError error={query.error} retry={() => void query.refetch()} />;
  const data = query.data!;
  function submit(event: FormEvent) { event.preventDefault(); const next = new URLSearchParams(params.toString()); search.trim() ? next.set("search", search.trim()) : next.delete("search"); next.set("page", "1"); router.replace(`/admin/users?${next}`); }
  function go(page: number) { const next = new URLSearchParams(params.toString()); next.set("page", String(page)); router.replace(`/admin/users?${next}`); }
  return <section className="admin-page"><header className="admin-page-heading"><div><h1>Пользователи</h1><p>Профили и экономика без промптов, исходных материалов и содержимого презентаций.</p></div></header>
    <form className="admin-filter-row" onSubmit={submit}><label><Search size={17} /><span className="sr-only">Поиск</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя, Telegram ID, username или user ID" /></label><button className="button" type="submit">Найти</button></form>
    <div className="admin-table-wrap">{data.items.length ? <table className="admin-table"><thead><tr><th>Пользователь</th><th>Тариф</th><th>Активность</th><th>Проекты / генерации</th><th>Расход</th><th>Выручка</th><th>Ошибки</th><th>Статус</th></tr></thead><tbody>{data.items.map((user) => <tr key={user.id}><td data-label="Пользователь"><Link className="admin-user-link" href={`/admin/users/${user.id}`}><span className="admin-avatar">{user.name?.slice(0, 1) || "?"}</span><span><strong>{user.name || "Без имени"}</strong><small>@{user.telegramUsername || "—"} · {user.telegramId || user.id}</small></span></Link></td><td data-label="Тариф"><span className="admin-plan">{user.effectivePlanCode}</span><small>{user.subscriptionStatus || "без подписки"}</small></td><td data-label="Активность"><DateTime value={user.lastSeenAt} /><small>Регистрация: <DateTime value={user.createdAt} /></small></td><td data-label="Проекты / генерации">{user.projects} / {user.generations}</td><td data-label="Расход"><Money value={user.totalCostRub} unknown={user.totalCostRub === null} /></td><td data-label="Выручка"><Money value={user.revenueRub} /></td><td data-label="Ошибки">{user.errors}</td><td data-label="Статус"><span className={user.blockedAt ? "admin-status admin-status-danger" : "admin-status admin-status-ok"}>{user.blockedAt ? "Заблокирован" : "Активен"}</span></td></tr>)}</tbody></table> : <AdminEmpty title="Пользователи не найдены" body="Очистите строку поиска или измените фильтры." />}</div>
    <div className="admin-pagination"><span>{data.total} пользователей</span><div><button className="ghost" disabled={data.page <= 1} onClick={() => go(data.page - 1)}>Назад</button><span>Страница {data.page}</span><button className="ghost" disabled={data.page * data.pageSize >= data.total} onClick={() => go(data.page + 1)}>Дальше</button></div></div>
  </section>;
}
