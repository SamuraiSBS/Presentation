"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  FileCheck2,
  FileSearch,
  FileText,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ProjectFact, ProjectRequirement, SourceRole } from "@studydeck/shared";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCreateDefenseFact,
  useDefenseWorkspace,
  useDeleteDefenseFact,
  useResolveDefenseConflict,
  useStartDefenseAnalysis,
  useUpdateDefenseAsset,
  useUpdateDefenseFact,
  useUpdateDefenseRequirement,
  type DefenseSource,
  type DefenseWorkspacePayload,
} from "@/lib/defense-queries";
import { defenseReviewCounts, requirementLabel } from "@/lib/defense-ui";
import { ApiClientError } from "@/lib/project-queries";

const priorityOptions = [
  { value: "required", label: "Обязательное" },
  { value: "recommended", label: "Рекомендуемое" },
  { value: "preference", label: "Пожелание" },
];

const roleOptions: Array<{ value: SourceRole; label: string }> = [
  { value: "project_document", label: "Описание проекта" },
  { value: "technical_spec", label: "Техническое ТЗ" },
  { value: "defense_spec", label: "ТЗ защиты" },
  { value: "style_reference", label: "Референс стиля" },
  { value: "screenshot", label: "Скриншот" },
  { value: "logo", label: "Логотип" },
  { value: "supporting_image", label: "Иллюстрация" },
  { value: "repository_document", label: "Документация репозитория" },
  { value: "archive_document", label: "Документ из ZIP" },
  { value: "web_image", label: "Интернет-иллюстрация" },
];

export function DefenseReviewWorkspace({ projectId, projectTitle, initialData }: { projectId: string; projectTitle: string; initialData: DefenseWorkspacePayload }) {
  const workspaceQuery = useDefenseWorkspace(projectId, initialData);
  const data = workspaceQuery.data || initialData;
  const counts = defenseReviewCounts(data);
  const canEdit = data.accessRole !== "viewer";
  const sourceById = useMemo(() => new Map(data.sources.map((source) => [source.id, source])), [data.sources]);
  const [newFact, setNewFact] = useState("");
  const [error, setError] = useState("");
  const createFact = useCreateDefenseFact(projectId);
  const updateFact = useUpdateDefenseFact(projectId);
  const deleteFact = useDeleteDefenseFact(projectId);
  const updateRequirement = useUpdateDefenseRequirement(projectId);
  const updateAsset = useUpdateDefenseAsset(projectId);
  const resolveConflict = useResolveDefenseConflict(projectId);
  const startAnalysis = useStartDefenseAnalysis(projectId);
  const busy = createFact.isPending || updateFact.isPending || deleteFact.isPending || updateRequirement.isPending || updateAsset.isPending || resolveConflict.isPending || startAnalysis.isPending;
  const analysisActive = ["queued", "analyzing"].includes(data.workspace.analysisStatus);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : fallback);
    }
  }

  async function addFact() {
    const statement = newFact.trim();
    if (statement.length < 2) {
      setError("Сформулируйте факт, который вы подтверждаете как автор проекта.");
      return;
    }
    await run(async () => {
      await createFact.mutateAsync(statement);
      setNewFact("");
    }, "Не получилось добавить факт.");
  }

  return (
    <section className="defense-workspace" aria-labelledby="defense-review-title">
      <header className="defense-workspace-header">
        <div>
          <span className={analysisActive ? "defense-ai-status" : "status"}>{analysisLabel(data.workspace.analysisStatus)}</span>
          <h1 id="defense-review-title">Проверьте основу защиты</h1>
          <p>«{projectTitle}» · AI ничего не переносит в презентацию без источника или вашего подтверждения.</p>
        </div>
        <div className="defense-header-actions">
          <Button variant="secondary" type="button" onClick={() => workspaceQuery.refetch()} disabled={workspaceQuery.isFetching}>{workspaceQuery.isFetching ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}Обновить</Button>
          <Button asChild><Link href={`/projects/${projectId}/defense/plan`}>Перейти к плану</Link></Button>
        </div>
      </header>

      <div className="defense-count-strip" aria-label="Сводка анализа">
        <Count label="Требования" value={counts.requirements} tone="orange" />
        <Count label="Подтверждённые факты" value={counts.facts} tone="green" />
        <Count label="Материалы" value={counts.sources} tone="purple" />
        <Count label="Нужно разрешить" value={counts.conflicts} tone={counts.conflicts ? "red" : "green"} />
      </div>

      {analysisActive ? <div className="defense-analysis-band" role="status" aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" /><div><strong>{data.workspace.analysisStatus === "queued" ? "Анализ ждёт запуска" : "Извлекаем факты и требования"}</strong><span>Страница обновляется автоматически. Можно оставить её открытой.</span></div></div> : null}
      {data.workspace.analysisStatus === "failed" ? <div className="defense-problem-band" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>Анализ не завершён</strong><span>{data.workspace.analysisError || "Материалы сохранены — можно повторить запрос."}</span></div>{canEdit ? <Button variant="secondary" type="button" onClick={() => run(() => startAnalysis.mutateAsync(undefined), "Не получилось повторить анализ.")}>Повторить анализ</Button> : null}</div> : null}

      <Tabs defaultValue="requirements" className="defense-review-tabs">
        <div className="defense-tabs-scroll"><TabsList aria-label="Данные защиты">
          <TabsTrigger value="requirements">Требования <span>{data.requirements.length}</span></TabsTrigger>
          <TabsTrigger value="facts">Факты <span>{data.facts.filter((item) => item.state === "active").length}</span></TabsTrigger>
          <TabsTrigger value="assets">Материалы <span>{data.sources.length}</span></TabsTrigger>
          <TabsTrigger value="conflicts">Противоречия <span>{counts.conflicts}</span></TabsTrigger>
        </TabsList></div>

        <TabsContent value="requirements">
          <SectionHeading title="Что должна выполнить презентация" description="Измените важность или исключите пункт. Источник и локатор сохраняются для отчёта." />
          {data.requirements.length ? <div className="defense-review-list">{data.requirements.map((requirement) => <RequirementRow key={requirement.id} requirement={requirement} source={requirement.sourceId ? sourceById.get(requirement.sourceId) : undefined} canEdit={canEdit} busy={busy} onUpdate={(patch) => run(() => updateRequirement.mutateAsync({ requirementId: requirement.id, patch }), "Не получилось изменить требование.")} />)}</div> : <EmptyState icon={<FileSearch />} title="Требования ещё не извлечены" text={analysisActive ? "Они появятся после анализа материалов." : "Запустите анализ или добавьте ТЗ защиты."} />}
        </TabsContent>

        <TabsContent value="facts">
          <SectionHeading title="Только подтверждённые сведения о проекте" description="Факт из документа показывает источник. Ручной факт явно помечается как подтверждённый автором." />
          {canEdit ? <div className="defense-add-fact"><label><span>Добавить факт от автора проекта</span><textarea className="textarea" value={newFact} onChange={(event) => setNewFact(event.target.value)} placeholder="Например: MVP протестировали 24 студента" /></label><Button type="button" onClick={addFact} disabled={busy || newFact.trim().length < 2}><Plus size={18} />Добавить факт</Button></div> : null}
          {data.facts.filter((item) => item.state === "active").length ? <div className="defense-review-list">{data.facts.filter((item) => item.state === "active").map((fact) => <FactRow key={fact.id} fact={fact} sourceById={sourceById} canEdit={canEdit} busy={busy} onSave={(statement) => run(() => updateFact.mutateAsync({ factId: fact.id, patch: { statement } }), "Не получилось сохранить факт.")} onDelete={() => run(() => deleteFact.mutateAsync(fact.id), "Не получилось удалить факт.")} />)}</div> : <EmptyState icon={<FileCheck2 />} title="Подтверждённых фактов пока нет" text="Добавьте факт вручную или дождитесь извлечения из документов." />}
        </TabsContent>

        <TabsContent value="assets">
          <SectionHeading title="Материалы и их роль" description="Роль определяет, можно ли использовать файл как доказательство, стиль или иллюстрацию." />
          {data.sources.length ? <div className="defense-review-list">{data.sources.map((source) => <AssetRow key={source.id} source={source} canEdit={canEdit} busy={busy} onRole={(role) => run(() => updateAsset.mutateAsync({ sourceId: source.id, patch: { role } }), "Не получилось изменить роль материала.")} />)}</div> : <EmptyState icon={<FileSearch />} title="Материалы не найдены" text="Вернитесь к черновику и добавьте хотя бы один источник проекта." />}
        </TabsContent>

        <TabsContent value="conflicts">
          <SectionHeading title="Разрешите каждое противоречие отдельно" description="Неразрешённый спор не блокирует черновик: вместо спорного значения появится заметный заполнитель." />
          {data.conflicts.length ? <div className="defense-review-list">{data.conflicts.map((conflict) => <article className={conflict.state === "unresolved" ? "defense-review-row defense-conflict-row" : "defense-review-row defense-review-row-resolved"} key={conflict.id}><div className="defense-review-row-main"><span className={conflict.state === "unresolved" ? "defense-item-status defense-item-status-problem" : "defense-item-status defense-item-status-ok"}>{conflict.state === "unresolved" ? "Нужно решение" : conflict.state === "resolved" ? "Разрешено" : "Не учитывать"}</span><h3>{conflict.summary}</h3><small>{conflictKindLabel(conflict.kind)}</small></div>{conflict.state === "unresolved" && canEdit ? <div className="defense-conflict-options">{conflict.options.map((option) => <button type="button" key={option.id} disabled={busy} onClick={() => run(() => resolveConflict.mutateAsync({ conflictId: conflict.id, input: { action: "resolve", resolution: { optionId: option.id } } }), "Не получилось сохранить решение.")}><strong>{option.label}</strong>{option.locator ? <span><MapPin size={13} />{option.locator}</span> : null}</button>)}<Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => run(() => resolveConflict.mutateAsync({ conflictId: conflict.id, input: { action: "ignore" } }), "Не получилось исключить конфликт.")}>Не учитывать</Button></div> : null}</article>)}</div> : <EmptyState icon={<Check />} title="Противоречий не найдено" text="Все извлечённые данные можно использовать без дополнительного решения." success />}
        </TabsContent>
      </Tabs>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer className="defense-review-footer"><div><strong>Следующий шаг — план защиты</strong><span>План покажет тайминг, требования, факты, материалы и заполнители по каждому слайду.</span></div><Button asChild><Link href={`/projects/${projectId}/defense/plan`}><Sparkles size={18} />Составить план</Link></Button></footer>
    </section>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: "orange" | "green" | "purple" | "red" }) {
  return <div data-tone={tone}><strong>{value}</strong><span>{label}</span></div>;
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="defense-section-heading"><h2>{title}</h2><p>{description}</p></div>;
}

function RequirementRow({ requirement, source, canEdit, busy, onUpdate }: { requirement: ProjectRequirement; source?: DefenseSource; canEdit: boolean; busy: boolean; onUpdate: (patch: { priority?: ProjectRequirement["priority"]; state?: ProjectRequirement["state"] }) => void }) {
  return <article className={requirement.state === "ignored" ? "defense-review-row defense-review-row-muted" : "defense-review-row"}><div className="defense-review-row-main"><span className={requirement.priority === "required" ? "defense-item-status defense-item-status-required" : "defense-item-status"}>{priorityLabel(requirement.priority)}</span><h3>{requirement.text}</h3><SourceLocator source={source} locator={requirementLabel(requirement)} /></div><div className="defense-row-actions"><Select value={requirement.priority} ariaLabel={`Важность: ${requirement.text}`} options={priorityOptions} disabled={!canEdit || busy || requirement.state === "ignored"} onValueChange={(priority) => onUpdate({ priority: priority as ProjectRequirement["priority"] })} /><Button variant="secondary" size="sm" type="button" disabled={!canEdit || busy} onClick={() => onUpdate({ state: requirement.state === "ignored" ? "active" : "ignored" })}>{requirement.state === "ignored" ? "Вернуть" : "Не учитывать"}</Button></div></article>;
}

function FactRow({ fact, sourceById, canEdit, busy, onSave, onDelete }: { fact: ProjectFact; sourceById: Map<string, DefenseSource>; canEdit: boolean; busy: boolean; onSave: (statement: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(fact.statement);
  const evidence = fact.evidence[0];
  const source = evidence?.sourceId ? sourceById.get(evidence.sourceId) : undefined;
  return <article className="defense-review-row"><div className="defense-review-row-main"><span className="defense-item-status defense-item-status-ok"><Check size={13} />{evidence?.confirmation === "user" ? "Подтверждено автором" : "Есть источник"}</span>{editing ? <textarea className="textarea defense-fact-edit" value={statement} onChange={(event) => setStatement(event.target.value)} /> : <h3>{fact.statement}</h3>}<SourceLocator source={source} locator={evidence?.confirmation === "user" ? "Подтверждено автором проекта" : evidence?.locator} /></div>{canEdit ? <div className="defense-row-actions">{editing ? <><Button size="sm" type="button" disabled={busy || statement.trim().length < 2} onClick={() => { onSave(statement.trim()); setEditing(false); }}><Save size={15} />Сохранить</Button><Button variant="secondary" size="sm" type="button" onClick={() => { setStatement(fact.statement); setEditing(false); }}>Отмена</Button></> : <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => setEditing(true)}>Изменить</Button>}<Button variant="secondary" size="sm" type="button" disabled={busy} onClick={onDelete}><Trash2 size={15} />Удалить</Button></div> : null}</article>;
}

function AssetRow({ source, canEdit, busy, onRole }: { source: DefenseSource; canEdit: boolean; busy: boolean; onRole: (role: SourceRole) => void }) {
  const metadata = source.metadata;
  const confidence = metadata?.image?.classification?.confidence;
  const locator = metadata?.locator || source.url;
  return <article className="defense-review-row"><div className="defense-review-row-main"><span className="defense-item-status defense-item-status-ai">{source.status === "processing" ? "Обрабатывается" : "Материал"}</span><h3>{source.label}</h3><SourceLocator source={source} locator={locator} />{confidence !== undefined ? <small>Уверенность классификации: {Math.round(confidence * 100)}%</small> : null}</div><div className="defense-row-actions"><Select value={source.role || "project_document"} ariaLabel={`Роль материала ${source.label}`} options={roleOptions} disabled={!canEdit || busy} onValueChange={(role) => onRole(role as SourceRole)} /></div></article>;
}

function SourceLocator({ source, locator }: { source?: DefenseSource; locator?: string }) {
  if (!source && !locator) return null;
  return <p className="defense-source-locator"><FileText size={14} aria-hidden="true" /><span>{source?.label || "Источник"}</span>{locator ? <><MapPin size={13} aria-hidden="true" /><span>{locator}</span></> : null}</p>;
}

function EmptyState({ icon, title, text, success = false }: { icon: ReactNode; title: string; text: string; success?: boolean }) {
  return <div className={success ? "defense-empty-state defense-empty-state-success" : "defense-empty-state"}>{icon}<div><strong>{title}</strong><span>{text}</span></div></div>;
}

function analysisLabel(status: string) {
  if (status === "queued") return "Анализ в очереди";
  if (status === "analyzing") return "AI анализирует материалы";
  if (status === "review_ready" || status === "ready") return "Данные готовы к проверке";
  if (status === "failed") return "Нужна проверка";
  return "Черновик";
}

function priorityLabel(priority: ProjectRequirement["priority"]) {
  return priority === "required" ? "Обязательное" : priority === "recommended" ? "Рекомендуемое" : "Пожелание";
}

function conflictKindLabel(kind: string) {
  return ({ fact: "Факт", requirement: "Требование", timing: "Тайминг", style: "Стиль" } as Record<string, string>)[kind] || "Данные";
}
