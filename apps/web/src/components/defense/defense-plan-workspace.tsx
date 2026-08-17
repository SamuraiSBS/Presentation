"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Clock3,
  FileWarning,
  LoaderCircle,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { DefensePlan, DefensePlanSlide, DefenseType } from "@studydeck/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import {
  useDefenseWorkspace,
  useConfirmDefensePlan,
  usePatchDefenseConfig,
  useRebuildDefensePlan,
  useSaveDefensePlan,
  type DefenseWorkspacePayload,
} from "@/lib/defense-queries";
import { defensePlanTiming, formatDefenseDuration, reorderDefensePlanSlides } from "@/lib/defense-ui";
import { ApiClientError } from "@/lib/project-queries";

export function DefensePlanWorkspace({ projectId, projectTitle, initialData }: { projectId: string; projectTitle: string; initialData: DefenseWorkspacePayload }) {
  const router = useRouter();
  const workspaceQuery = useDefenseWorkspace(projectId, initialData);
  const data = workspaceQuery.data || initialData;
  const [plan, setPlan] = useState<DefensePlan | null>(data.workspace.plan);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [typeChoice, setTypeChoice] = useState<DefenseType>(data.workspace.defenseType);
  const savePlan = useSaveDefensePlan(projectId);
  const rebuildPlan = useRebuildDefensePlan(projectId);
  const confirmPlan = useConfirmDefensePlan(projectId);
  const patchConfig = usePatchDefenseConfig(projectId);
  const canEdit = data.accessRole !== "viewer";
  const planLocked = plan?.status === "approved";
  const canEditPlan = canEdit && !planLocked;
  const canStartNarration = canEdit && Boolean(plan);
  const busy = savePlan.isPending || rebuildPlan.isPending || confirmPlan.isPending || patchConfig.isPending;
  const total = plan ? defensePlanTiming(plan.slides) : 0;
  const overTarget = total > data.workspace.targetDurationSeconds;
  const blankTitles = plan?.slides.some((slide) => slide.title.trim().length < 1 || slide.purpose.trim().length < 1);
  const placeholderCount = useMemo(() => plan?.slides.reduce((sum, slide) => sum + slide.placeholders.filter((item) => !item.resolved).length, 0) || 0, [plan]);

  useEffect(() => {
    if (!dirty) setPlan(data.workspace.plan);
  }, [data.workspace.plan, dirty]);

  function updateSlide(index: number, patch: Partial<DefensePlanSlide>) {
    if (!canEditPlan) return;
    setPlan((current) => current ? normalizePlan({ ...current, status: "draft", approvedAt: null, slides: current.slides.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...patch } : slide) }) : current);
    setDirty(true);
  }

  function moveSlide(index: number, direction: -1 | 1) {
    if (!canEditPlan) return;
    setPlan((current) => current ? reorderDefensePlanSlides(current, index, index + direction) : current);
    setDirty(true);
  }

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError("");
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : fallback);
      return null;
    }
  }

  async function buildPlan() {
    if (!canEditPlan) return;
    const result = await run(() => rebuildPlan.mutateAsync({ expectedAnalysisRevision: data.workspace.analysisRevision, expectedPlanRevision: data.workspace.planRevision, confirmPresetRebuild: true }), "Не получилось составить план. Проверьте требования и повторите попытку.");
    if (result) await workspaceQuery.refetch();
  }

  async function saveCurrent(nextPlan = plan) {
    if (!canEditPlan) return null;
    if (!nextPlan || blankTitles) {
      setError("У каждого слайда должны быть заголовок и задача.");
      return null;
    }
    const normalized = normalizePlan(nextPlan);
    const result = await run(() => savePlan.mutateAsync({ plan: normalized, expectedPlanRevision: data.workspace.planRevision }), "Не получилось сохранить план.");
    if (result) {
      setPlan(normalized);
      setDirty(false);
    }
    return result;
  }

  async function approveAndStart() {
    if (!canStartNarration) return;
    if (!plan || (!planLocked && (overTarget || blankTitles))) {
      setError(overTarget ? "Сократите тайминг до целевой продолжительности перед подтверждением." : "Проверьте заголовки и задачи всех слайдов.");
      return;
    }
    const expectedPlanRevision = planLocked ? data.workspace.planRevision - 1 : data.workspace.planRevision;
    const confirmed = await run(() => confirmPlan.mutateAsync({ expectedAnalysisRevision: data.workspace.analysisRevision, expectedPlanRevision }), "Не получилось запустить подготовку речи. Обновите страницу и повторите попытку.");
    if (!confirmed) return;
    router.push(`/projects/${projectId}/script`);
  }

  async function switchType() {
    if (!canEditPlan) return;
    if (typeChoice === data.workspace.defenseType) return;
    const updated = await run(() => patchConfig.mutateAsync({ defenseType: typeChoice, confirmPresetRebuild: true, expectedAnalysisRevision: data.workspace.analysisRevision }), "Не получилось изменить тип защиты.");
    if (!updated) return;
    setDirty(false);
    await workspaceQuery.refetch();
  }

  if (!plan) {
    return (
      <section className="defense-plan-empty" aria-labelledby="defense-plan-title">
        <span className="status">План защиты</span>
        <h1 id="defense-plan-title">Распределите требования по слайдам</h1>
        <p>Lazyum соберёт редактируемый план из проверенных требований, фактов и материалов. Неразрешённые данные останутся заполнителями.</p>
        {data.workspace.analysisStatus === "queued" || data.workspace.analysisStatus === "analyzing" ? <div className="defense-analysis-band"><LoaderCircle className="spin" /><div><strong>Сначала завершается анализ</strong><span>Вернитесь к проверке материалов и дождитесь готовности данных.</span></div></div> : null}
        <div className="defense-plan-empty-actions"><Button variant="secondary" asChild><Link href={`/projects/${projectId}/defense/review`}><ArrowLeft size={18} />К проверке данных</Link></Button>{canEdit ? <Button type="button" onClick={buildPlan} disabled={busy || ["queued", "analyzing"].includes(data.workspace.analysisStatus)}>{rebuildPlan.isPending ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}{rebuildPlan.isPending ? "Составляем…" : "Составить план защиты"}</Button> : null}</div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="defense-plan-workspace" aria-labelledby="defense-plan-title">
      <header className="defense-workspace-header">
        <div><span className="status">План защиты</span><h1 id="defense-plan-title">Проверьте порядок и тайминг</h1><p>«{projectTitle}» · требования и подтверждённые факты уже привязаны к слайдам.</p></div>
        <div className="defense-header-actions"><Button variant="secondary" asChild><Link href={`/projects/${projectId}/defense/review`}><ArrowLeft size={18} />Данные</Link></Button>{canEditPlan ? <Dialog><DialogTrigger asChild><Button variant="secondary" type="button">Тип: {data.workspace.defenseType === "hackathon" ? "хакатон" : "диплом"}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Изменить тип защиты?</DialogTitle><DialogDescription>Встроенные пункты плана будут перестроены. Загруженные материалы, подтверждённые факты и пользовательские требования сохранятся.</DialogDescription></DialogHeader><Select value={typeChoice} ariaLabel="Новый тип защиты" options={[{ value: "hackathon", label: "Хакатон" }, { value: "diploma", label: "Диплом" }]} onValueChange={(value) => setTypeChoice(value as DefenseType)} /><div className="ui-dialog-actions"><DialogClose asChild><Button variant="secondary" type="button">Отмена</Button></DialogClose><DialogClose asChild><Button type="button" onClick={switchType} disabled={busy || typeChoice === data.workspace.defenseType}>Перестроить план</Button></DialogClose></div></DialogContent></Dialog> : null}</div>
      </header>

      <div className={overTarget ? "defense-plan-summary defense-plan-summary-warning" : "defense-plan-summary"}>
        <div><Clock3 aria-hidden="true" /><span><strong>{formatDefenseDuration(total)}</strong><small>из {formatDefenseDuration(data.workspace.targetDurationSeconds)}</small></span></div>
        <div><strong>{plan.slides.length}</strong><span>слайдов</span></div>
        <div><strong>{placeholderCount}</strong><span>заполнителей</span></div>
        <p>{overTarget ? "Тайминг превышен. Сократите время отдельных слайдов." : "Тайминг укладывается в выбранную продолжительность."}</p>
      </div>

      <div className="defense-plan-list">
        {plan.slides.map((slide, index) => (
          <article className="defense-plan-slide" key={slide.id}>
            <div className="defense-plan-order"><span>{String(index + 1).padStart(2, "0")}</span>{canEditPlan ? <div><button type="button" aria-label={`Поднять слайд ${index + 1}`} disabled={busy || index === 0} onClick={() => moveSlide(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Опустить слайд ${index + 1}`} disabled={busy || index === plan.slides.length - 1} onClick={() => moveSlide(index, 1)}><ArrowDown size={16} /></button></div> : null}</div>
            <div className="defense-plan-fields">
              <label><span>Заголовок</span><input className="input" value={slide.title} readOnly={!canEditPlan} onChange={(event) => updateSlide(index, { title: event.target.value })} /></label>
              <label><span>Задача слайда</span><textarea className="textarea" value={slide.purpose} readOnly={!canEditPlan} onChange={(event) => updateSlide(index, { purpose: event.target.value })} /></label>
              {slide.visualStrategy ? <p><Sparkles size={14} />{slide.visualStrategy}</p> : null}
            </div>
            <div className="defense-plan-meta">
              <label><Clock3 size={15} /><input type="number" min={20} max={240} value={slide.timingSeconds} readOnly={!canEditPlan} onChange={(event) => updateSlide(index, { timingSeconds: Math.max(20, Math.min(240, Number(event.target.value))) })} /><span>сек</span></label>
              <div className="defense-plan-badges"><span>{slide.requirementIds.length} треб.</span><span>{slide.factIds.length} факт.</span><span>{slide.assetSourceIds.length} матер.</span>{slide.placeholders.filter((item) => !item.resolved).length ? <span className="defense-plan-badge-warning"><FileWarning size={13} />{slide.placeholders.filter((item) => !item.resolved).length} заполн.</span> : null}</div>
              {slide.adaptiveChangeReason ? <small>Адаптация: {slide.adaptiveChangeReason}</small> : null}
            </div>
          </article>
        ))}
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer className="defense-plan-toolbar"><div><strong>{dirty ? "Есть несохранённые изменения" : planLocked ? "План подтверждён" : "План сохранён как черновик"}</strong><span>{planLocked ? "План зафиксирован. При сбое речи повторите подготовку по этой утверждённой основе." : "Перед запуском речи сохраните порядок, формулировки и тайминг."}</span></div>{canEditPlan ? <div><Button variant="secondary" type="button" onClick={() => saveCurrent()} disabled={busy || !dirty}>{savePlan.isPending ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}Сохранить</Button><Button variant="secondary" type="button" onClick={buildPlan} disabled={busy}><RefreshCw size={18} />Пересобрать</Button><NarrationConfirmation title="Подтвердить план и запустить AI?" description="План станет основой речи. Запуск создаёт отдельный запрос к AI-провайдеру и может расходовать его платный баланс." label="Подтвердить и готовить речь" pending={confirmPlan.isPending} busy={busy || dirty || overTarget} onConfirm={approveAndStart} /></div> : planLocked && canStartNarration ? <div><NarrationConfirmation title="Повторить подготовку речи?" description="Повтор использует уже подтверждённый план защиты и создаёт новый платный запрос к AI-провайдеру." label="Повторить подготовку речи" pending={confirmPlan.isPending} busy={busy} onConfirm={approveAndStart} /><Button variant="secondary" asChild><Link href={`/projects/${projectId}/script`}>Открыть речь</Link></Button></div> : null}</footer>
    </section>
  );
}

function NarrationConfirmation({ title, description, label, pending, busy, onConfirm }: { title: string; description: string; label: string; pending: boolean; busy: boolean; onConfirm: () => void | Promise<void> }) {
  return <Dialog><DialogTrigger asChild><Button type="button" disabled={busy}><Rocket size={18} />{label}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="ai-cost-warning"><ShieldCheck aria-hidden="true" /><div><strong>Перед запуском</strong><span>Проверьте баланс Yandex/OpenAI. Факты будут взяты только из подтверждённой основы.</span></div></div><div className="ui-dialog-actions"><DialogClose asChild><Button variant="secondary" type="button">Вернуться к плану</Button></DialogClose><DialogClose asChild><Button type="button" onClick={onConfirm} disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}{label}</Button></DialogClose></div></DialogContent></Dialog>;
}

function normalizePlan(plan: DefensePlan): DefensePlan {
  const slides = plan.slides.map((slide, index) => ({ ...slide, order: index + 1 }));
  return { ...plan, slides, totalTimingSeconds: defensePlanTiming(slides) };
}
