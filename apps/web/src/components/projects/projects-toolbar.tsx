"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { FolderSummary, UsageSummary } from "@/lib/account-types";

const scopes = [{ value: "all", label: "Все" }, { value: "mine", label: "Мои" }, { value: "shared", label: "Доступные мне" }];

export function ProjectsToolbar({ folders, usage, initialQuery }: { folders: FolderSummary[]; usage: UsageSummary; initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const initial = new URLSearchParams(initialQuery);
  const [search, setSearch] = useState(initial.get("search") || "");

  function update(key: string, value: string) {
    const params = new URLSearchParams(window.location.search);
    params.delete("cursor");
    if (value && !(key === "scope" && value === "all")) params.set(key, value);
    else params.delete(key);
    router.replace(`${pathname}${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => update("search", search.trim()), 320);
    return () => window.clearTimeout(timer);
    // update intentionally reads the latest URL when the debounce fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const scope = initial.get("scope") || "all";
  return (
    <section className="projects-toolbar" aria-label="Фильтры презентаций">
      <div className="scope-tabs" role="tablist" aria-label="Область списка">
        {scopes.map((item) => <button className={scope === item.value ? "scope-tab scope-tab-active" : "scope-tab"} key={item.value} type="button" role="tab" aria-selected={scope === item.value} onClick={() => update("scope", item.value)}>{item.label}</button>)}
      </div>
      <label className="projects-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Поиск</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти по названию" /></label>
      <div className="projects-filters">
        <label><span className="sr-only">Статус</span><select defaultValue={initial.get("status") || ""} onChange={(event) => update("status", event.target.value)}><option value="">Все статусы</option><option value="draft">Черновики</option><option value="generating">Создаются</option><option value="ready">Готовые</option><option value="failed">С ошибкой</option></select></label>
        <label><span className="sr-only">Папка</span><select defaultValue={initial.get("folderId") || ""} onChange={(event) => update("folderId", event.target.value)}><option value="">Все папки</option><option value="none">Без папки</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></label>
        <label><span className="sr-only">Сортировка</span><select defaultValue={initial.get("sort") || "updated_desc"} onChange={(event) => update("sort", event.target.value)}><option value="updated_desc">Недавно изменённые</option><option value="created_desc">Сначала новые</option><option value="title_asc">По названию</option></select></label>
      </div>
      <span className="toolbar-usage">{usage.used}/{usage.limit} в этом месяце</span>
    </section>
  );
}
