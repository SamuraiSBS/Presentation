"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  Check,
  FileArchive,
  FileImage,
  FileText,
  GitBranch,
  LoaderCircle,
  Plus,
  Rocket,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type {
  ComplianceMode,
  DefenseAuthorProfile,
  DefenseType,
  SourceRole,
  UploadSourceRole,
} from "@studydeck/shared";
import { DEFENSE_UPLOAD_MAX_FILE_BYTES, DEFENSE_UPLOAD_MAX_FILES } from "@studydeck/shared";
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
import { fadeSlideVariants } from "@/components/motion/motion-presets";
import type { UsageSummary } from "@/lib/account-types";
import { canCreateProject } from "@/lib/account-types";
import { ApiClientError, apiJson } from "@/lib/project-queries";
import { formatResetDate } from "@/lib/project-ui";
import type { DefenseSource, DefenseWorkspacePayload } from "@/lib/defense-queries";

type MaterialFile = {
  id: string;
  file: File;
  role: UploadSourceRole;
};

type SavedDefenseSource = Pick<DefenseSource, "id" | "label" | "role" | "included" | "url">;

type WizardField = "title" | "repository" | "projectFiles" | "materials" | "authorProfile" | "slides" | "duration";
type WizardFieldErrors = Partial<Record<WizardField, string>>;

const projectFileExtensions = new Set(["txt", "md", "pdf", "docx", "pptx", "zip"]);
const materialFileExtensions = new Set([...projectFileExtensions, "png", "jpg", "jpeg", "webp"]);
const authorFieldLimits: Partial<Record<keyof DefenseAuthorProfile, number>> = {
  fullName: 160,
  institution: 240,
  department: 240,
  group: 80,
  supervisor: 160,
  city: 120,
  teamName: 160,
  eventName: 200,
  year: 4,
};

const materialRoles: Array<{ value: UploadSourceRole; label: string }> = [
  { value: "technical_spec", label: "Техническое ТЗ" },
  { value: "defense_spec", label: "Требования к защите" },
  { value: "style_reference", label: "PPTX-референс стиля" },
  { value: "screenshot", label: "Скриншот интерфейса" },
  { value: "logo", label: "Логотип" },
  { value: "supporting_image", label: "Иллюстрация проекта" },
];

const stepLabels = ["Правила", "Проект", "Материалы", "Автор"];

export function DefenseWizard({ usage, maxSlides }: { usage: UsageSummary; maxSlides: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const creationAllowed = canCreateProject(usage);
  const [step, setStep] = useState(0);
  const [defenseType, setDefenseType] = useState<DefenseType>("hackathon");
  const [complianceMode, setComplianceMode] = useState<ComplianceMode>("strict");
  const [targetSlideCount, setTargetSlideCount] = useState(Math.min(10, maxSlides));
  const [targetDurationMinutes, setTargetDurationMinutes] = useState(7);
  const [title, setTitle] = useState("");
  const [projectFiles, setProjectFiles] = useState<File[]>([]);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [materials, setMaterials] = useState<MaterialFile[]>([]);
  const [allowWebImages, setAllowWebImages] = useState(false);
  const [authorProfile, setAuthorProfile] = useState<DefenseAuthorProfile>({ year: String(new Date().getFullYear()) });
  const [draftId, setDraftId] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const [savedRepositoryUrl, setSavedRepositoryUrl] = useState("");
  const [savedSources, setSavedSources] = useState<SavedDefenseSource[]>([]);
  const [analysisRevision, setAnalysisRevision] = useState<number | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<WizardFieldErrors>({});
  const [loadingDraft, setLoadingDraft] = useState(false);
  const loadedDraftId = useRef<string | null>(null);
  const fallbackIdempotencyKeys = useRef<Record<string, string>>({});
  const titleInput = useRef<HTMLInputElement>(null);

  const requestedDraftId = searchParams.get("draft")?.trim() || "";
  const hasSavedProjectSource = savedSources.some((source) => source.included !== false && isProjectSourceRole(source.role));
  const hasProjectSource = projectFiles.length > 0 || Boolean(repositoryUrl.trim()) || hasSavedProjectSource;
  const hasPendingRepository = Boolean(repositoryUrl.trim()) && repositoryUrl.trim() !== savedRepositoryUrl;
  const hasPendingSources = projectFiles.length > 0 || materials.length > 0 || hasPendingRepository;
  const draftDirty = configDirty || hasPendingSources || (Boolean(draftId) && title.trim() !== savedTitle);
  const cleanAuthorProfile = useMemo(
    () => Object.fromEntries(Object.entries(authorProfile).filter(([, value]) => value?.trim())) as DefenseAuthorProfile,
    [authorProfile],
  );

  const hydrateDraft = useCallback((projectId: string, payload: DefenseWorkspacePayload, projectTitle = "") => {
    const workspace = payload.workspace;
    const sources = payload.sources.map((source) => ({
      id: source.id,
      label: source.label,
      role: source.role,
      included: source.included,
      url: source.url,
    }));
    const repository = sources.find((source) => source.role === "repository_document" && source.included !== false)?.url || "";

    setDraftId(projectId);
    setDefenseType(workspace.defenseType);
    setComplianceMode(workspace.complianceMode);
    setTargetSlideCount(workspace.targetSlideCount);
    setTargetDurationMinutes(Math.max(1, Math.round(workspace.targetDurationSeconds / 60)));
    setAllowWebImages(workspace.allowWebImages);
    setAuthorProfile(workspace.authorProfile || {});
    setAnalysisRevision(workspace.analysisRevision);
    setSavedSources(sources);
    setSavedRepositoryUrl(repository);
    setRepositoryUrl(repository);
    if (projectTitle) {
      setTitle(projectTitle);
      setSavedTitle(projectTitle);
    }
    setProjectFiles([]);
    setMaterials([]);
    setConfigDirty(false);
    setDraftReady(true);
    setStep(3);
  }, []);

  const loadDraft = useCallback(async (projectId: string, updateUrl = false) => {
    setLoadingDraft(true);
    setError("");
    try {
      const payload = await apiJson<DefenseWorkspacePayload>(`/api/projects/${encodeURIComponent(projectId)}/defense`);
      let projectTitle = "";
      try {
        const project = await apiJson<{ title?: string }>(`/api/projects/${encodeURIComponent(projectId)}`);
        projectTitle = project.title || "";
      } catch {
        // The defense workspace remains usable even if the generic project title cannot be reloaded.
      }
      hydrateDraft(projectId, payload, projectTitle);
      loadedDraftId.current = projectId;
      if (updateUrl) router.replace(`/new/defense?draft=${encodeURIComponent(projectId)}`, { scroll: false });
      return payload;
    } catch (cause) {
      setError(userError(cause, "Не удалось открыть черновик защиты. Проверьте подключение и попробуйте ещё раз."));
      return null;
    } finally {
      setLoadingDraft(false);
    }
  }, [hydrateDraft, router]);

  useEffect(() => {
    if (!requestedDraftId || loadedDraftId.current === requestedDraftId) return;
    void loadDraft(requestedDraftId);
  }, [loadDraft, requestedDraftId]);

  function idempotencyKey(scope: string) {
    const storageKey = `studydeck:defense:idempotency:${scope}`;
    if (typeof window !== "undefined") {
      try {
        const persisted = window.sessionStorage.getItem(storageKey);
        if (persisted) return persisted;
        const created = createIdempotencyKey(`defense-${scope}`);
        window.sessionStorage.setItem(storageKey, created);
        return created;
      } catch {
        // Fall back to a component-stable key when session storage is unavailable.
      }
    }
    fallbackIdempotencyKeys.current[scope] ||= createIdempotencyKey(`defense-${scope}`);
    return fallbackIdempotencyKeys.current[scope];
  }

  function clearIdempotencyKey(scope: string) {
    delete fallbackIdempotencyKeys.current[scope];
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(`studydeck:defense:idempotency:${scope}`);
    } catch {
      // Storage cleanup is best-effort and does not affect the completed request.
    }
  }

  function chooseDefenseType(next: DefenseType) {
    setDefenseType(next);
    setTargetSlideCount(Math.min(next === "hackathon" ? 10 : 12, maxSlides));
    setTargetDurationMinutes(next === "hackathon" ? 7 : 10);
    setConfigDirty(true);
  }

  function goNext() {
    setError("");
    setFieldErrors({});
    if (step === 0) {
      if (targetSlideCount < 4 || targetSlideCount > Math.min(20, maxSlides)) {
        setError(`Укажите от 4 до ${Math.min(20, maxSlides)} слайдов.`);
        setFieldErrors({ slides: `Укажите от 4 до ${Math.min(20, maxSlides)} слайдов.` });
        return;
      }
      if (targetDurationMinutes < 1 || targetDurationMinutes > 15) {
        setError("Продолжительность должна быть от 1 до 15 минут.");
        setFieldErrors({ duration: "Продолжительность должна быть от 1 до 15 минут." });
        return;
      }
    }
    if (step === 1) {
      if (title.trim().length < 2) {
        setError("Укажите название проекта.");
        setFieldErrors({ title: "Укажите название проекта не короче двух символов." });
        titleInput.current?.focus();
        return;
      }
      if (title.trim().length > 140) {
        setError("Название проекта не должно быть длиннее 140 символов.");
        setFieldErrors({ title: "Название проекта не должно быть длиннее 140 символов." });
        titleInput.current?.focus();
        return;
      }
      if (!hasProjectSource) {
        setError("Добавьте документ, ZIP проекта или ссылку на публичный GitHub/GitLab.");
        setFieldErrors({ projectFiles: "Добавьте хотя бы один источник проекта." });
        return;
      }
      if (repositoryUrl.trim() && !isPublicRepositoryUrl(repositoryUrl)) {
        setError("Нужна публичная ссылка на репозиторий GitHub или GitLab.");
        setFieldErrors({ repository: "Укажите ссылку на корень публичного репозитория GitHub или GitLab без параметров." });
        return;
      }
    }
    setStep((current) => Math.min(3, current + 1));
  }

  function addProjectFiles(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files || []);
    const checked = prepareDefenseFiles(next, projectFileExtensions, projectFiles.length + materials.length);
    if (checked.error) {
      setError(checked.error);
      setFieldErrors({ projectFiles: checked.error });
    } else {
      setProjectFiles((current) => uniqueFiles([...current, ...checked.files]));
      setFieldErrors((current) => ({ ...current, projectFiles: undefined }));
      setError("");
    }
    event.target.value = "";
  }

  function addMaterials(event: ChangeEvent<HTMLInputElement>) {
    const checked = prepareDefenseFiles(Array.from(event.target.files || []), materialFileExtensions, projectFiles.length + materials.length);
    if (checked.error) {
      setError(checked.error);
      setFieldErrors({ materials: checked.error });
      event.target.value = "";
      return;
    }
    const next = checked.files.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      role: suggestedRole(file),
    }));
    setMaterials((current) => [...current, ...next]);
    setFieldErrors((current) => ({ ...current, materials: undefined }));
    setError("");
    event.target.value = "";
  }

  async function saveDraft() {
    if (!creationAllowed) return;
    const authorError = validateAuthorProfile(cleanAuthorProfile);
    if (!draftId && title.trim().length < 2) {
      setError("Укажите название проекта.");
      setFieldErrors({ title: "Укажите название проекта не короче двух символов." });
      titleInput.current?.focus();
      return;
    }
    if (title.trim().length > 140) {
      setError("Название проекта не должно быть длиннее 140 символов.");
      setFieldErrors({ title: "Название проекта не должно быть длиннее 140 символов." });
      titleInput.current?.focus();
      return;
    }
    if (!hasProjectSource) {
      setError("Добавьте хотя бы один источник проекта перед сохранением черновика.");
      setFieldErrors({ projectFiles: "Добавьте хотя бы один источник проекта." });
      return;
    }
    if (repositoryUrl.trim() && !isPublicRepositoryUrl(repositoryUrl)) {
      setError("Нужна публичная ссылка на корень репозитория GitHub или GitLab.");
      setFieldErrors({ repository: "Укажите ссылку на публичный репозиторий без параметров и фрагментов." });
      return;
    }
    if (authorError) {
      setError(authorError);
      setFieldErrors({ authorProfile: authorError });
      return;
    }
    setBusy(true);
    setError("");
    setFieldErrors({});
    let saveStage: "create" | "metadata" | "config" | "repository" | "uploads" = "create";
    let projectCreated = Boolean(draftId);
    try {
      let projectId = draftId;
      let nextAnalysisRevision = analysisRevision;
      if (!projectId) {
        const project = await apiJson<{ id: string }>("/api/projects/defense", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim(), ...currentConfig(), idempotencyKey: idempotencyKey("create") }),
        });
        projectId = project.id;
        clearIdempotencyKey("create");
        nextAnalysisRevision = 0;
        setDraftId(projectId);
        setAnalysisRevision(nextAnalysisRevision);
        projectCreated = true;
        setSavedTitle(title.trim());
        loadedDraftId.current = projectId;
        router.replace(`/new/defense?draft=${encodeURIComponent(projectId)}`, { scroll: false });
      } else if (title.trim() && title.trim() !== savedTitle) {
        saveStage = "metadata";
        await apiJson(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim() }),
        });
        setSavedTitle(title.trim());
      }

      if (projectId && configDirty) {
        saveStage = "config";
        const updated = await apiJson<DefenseWorkspacePayload>(`/api/projects/${encodeURIComponent(projectId)}/defense/config`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...currentConfig(),
            confirmPresetRebuild: true,
            ...(nextAnalysisRevision === null ? {} : { expectedAnalysisRevision: nextAnalysisRevision }),
          }),
        });
        nextAnalysisRevision = updated.workspace.analysisRevision;
        setAnalysisRevision(nextAnalysisRevision);
        setConfigDirty(false);
      }

      if (repositoryUrl.trim() && repositoryUrl.trim() !== savedRepositoryUrl) {
        saveStage = "repository";
        const repository = await apiJson<{ analysisRevision?: number }>(`/api/projects/${encodeURIComponent(projectId)}/defense/repositories`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: repositoryUrl.trim(),
            ...(nextAnalysisRevision === null ? {} : { expectedAnalysisRevision: nextAnalysisRevision }),
          }),
        });
        nextAnalysisRevision = repository.analysisRevision ?? nextAnalysisRevision;
        setAnalysisRevision(nextAnalysisRevision);
        setSavedRepositoryUrl(repositoryUrl.trim());
      }

      if (projectFiles.length || materials.length) {
        saveStage = "uploads";
        const entries = [
          ...projectFiles.map((file) => ({ file, role: "project_document" as const })),
          ...materials.map(({ file, role }) => ({ file, role })),
        ];
        const body = new FormData();
        const manifest = entries.map(({ file, role }, index) => {
          const fieldName = `file_${index}`;
          body.append(fieldName, file);
          return { fieldName, role, label: file.name };
        });
        body.append("manifest", JSON.stringify({
          files: manifest,
          ...(nextAnalysisRevision === null ? {} : { expectedAnalysisRevision: nextAnalysisRevision }),
          idempotencyKey: idempotencyKey(`upload:${projectId}`),
        }));
        await apiJson(`/api/projects/${encodeURIComponent(projectId)}/defense/uploads`, { method: "POST", body });
        clearIdempotencyKey(`upload:${projectId}`);
      }

      await loadDraft(projectId, true);
      setDraftReady(true);
    } catch (cause) {
      setError(userError(cause, saveDraftFallback(saveStage, projectCreated)));
    } finally {
      setBusy(false);
    }
  }

  async function startAnalysis() {
    if (!draftId || !draftReady || draftDirty || analysisRevision === null) return;
    setAnalysisBusy(true);
    setError("");
    try {
      await apiJson(`/api/projects/${draftId}/defense/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmCost: true,
          expectedAnalysisRevision: analysisRevision,
          idempotencyKey: idempotencyKey(`analysis:${draftId}:${analysisRevision}`),
        }),
      });
      router.push(`/projects/${draftId}/defense/review`);
    } catch (cause) {
      setError(userError(cause, "Не получилось запустить анализ. Черновик и материалы сохранены."));
    } finally {
      setAnalysisBusy(false);
    }
  }

  async function setSavedSourceIncluded(sourceId: string, included: boolean) {
    if (!draftId || analysisRevision === null) return;
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/projects/${encodeURIComponent(draftId)}/defense/assets/${encodeURIComponent(sourceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ included, expectedAnalysisRevision: analysisRevision }),
      });
      await loadDraft(draftId, true);
    } catch (cause) {
      setError(userError(cause, "Не удалось изменить участие материала. Обновите черновик и повторите попытку."));
    } finally {
      setBusy(false);
    }
  }

  function currentConfig() {
    return {
      defenseType,
      complianceMode,
      targetSlideCount,
      targetDurationSeconds: targetDurationMinutes * 60,
      allowWebImages,
      authorProfile: cleanAuthorProfile,
    };
  }

  return (
    <section className="defense-wizard" aria-label="Создание защиты проекта" aria-busy={busy || loadingDraft}>
      {!creationAllowed ? (
        <div className="usage-blocked" role="alert">
          <strong>Лимит на этот месяц исчерпан</strong>
          <span>Новый проект можно создать {formatResetDate(usage)}.</span>
          <Link className="ghost" href="/projects">Открыть проекты</Link>
        </div>
      ) : null}

      <nav className="defense-stepper" aria-label="Шаги настройки защиты">
        {stepLabels.map((label, index) => (
          <button
            className={index === step ? "defense-step defense-step-active" : index < step ? "defense-step defense-step-complete" : "defense-step"}
            key={label}
            type="button"
            aria-current={index === step ? "step" : undefined}
            disabled={index > step || busy || loadingDraft}
            onClick={() => setStep(index)}
          >
            <span>{index < step ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : index + 1}</span>
            <strong>{label}</strong>
          </button>
        ))}
      </nav>

      <div className="defense-wizard-surface">
        {loadingDraft ? <p className="defense-draft-loading" role="status" aria-live="polite"><LoaderCircle className="spin" size={18} />Открываем сохранённый черновик…</p> : null}
        <AnimatePresence initial={false} mode="wait">
          {step === 0 ? (
            <motion.div className="defense-pane" key="rules" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
              <WizardHeading title="Как проходит защита?" description="Выберите формат и пределы. Тип и режим можно изменить до подтверждения плана." />
              <fieldset className="defense-choice-group">
                <legend>Тип защиты</legend>
                <Choice checked={defenseType === "hackathon"} title="Хакатон" description="Демо, команда и результат · обычно 10 слайдов / 7 минут" onClick={() => chooseDefenseType("hackathon")} onKeyDown={(event) => selectRadioWithArrow(event, ["hackathon", "diploma"], chooseDefenseType)} />
                <Choice checked={defenseType === "diploma"} title="Диплом" description="Цель, требования, реализация и выводы · обычно 12 слайдов / 10 минут" onClick={() => chooseDefenseType("diploma")} onKeyDown={(event) => selectRadioWithArrow(event, ["hackathon", "diploma"], chooseDefenseType)} />
              </fieldset>
              <fieldset className="defense-choice-group">
                <legend>Следование ТЗ</legend>
                <Choice checked={complianceMode === "strict"} title="Строго" description="Не хватает факта — показываем заполнитель, а не додумываем." onClick={() => { setComplianceMode("strict"); setConfigDirty(true); }} onKeyDown={(event) => selectRadioWithArrow(event, ["strict", "adaptive"], (value) => { setComplianceMode(value); setConfigDirty(true); })} />
                <Choice checked={complianceMode === "adaptive"} title="Адаптивно" description="Обязательное сохраняем, подачу и порядок можно улучшить." onClick={() => { setComplianceMode("adaptive"); setConfigDirty(true); }} onKeyDown={(event) => selectRadioWithArrow(event, ["strict", "adaptive"], (value) => { setComplianceMode(value); setConfigDirty(true); })} />
              </fieldset>
              <div className="defense-number-row">
                <label htmlFor="defense-slide-count">Слайдов<input id="defense-slide-count" className="input" type="number" min={4} max={Math.min(20, maxSlides)} value={targetSlideCount} aria-invalid={Boolean(fieldErrors.slides)} aria-describedby={fieldErrors.slides ? "defense-slide-count-error" : undefined} onChange={(event) => { setTargetSlideCount(Number(event.target.value)); setConfigDirty(true); }} /></label>
                <label htmlFor="defense-duration">Минут<input id="defense-duration" className="input" type="number" min={1} max={15} value={targetDurationMinutes} aria-invalid={Boolean(fieldErrors.duration)} aria-describedby={fieldErrors.duration ? "defense-duration-error" : undefined} onChange={(event) => { setTargetDurationMinutes(Number(event.target.value)); setConfigDirty(true); }} /></label>
              </div>
              {fieldErrors.slides ? <p className="defense-field-error" id="defense-slide-count-error">{fieldErrors.slides}</p> : null}
              {fieldErrors.duration ? <p className="defense-field-error" id="defense-duration-error">{fieldErrors.duration}</p> : null}
            </motion.div>
          ) : null}

          {step === 1 ? (
            <motion.div className="defense-pane" key="project" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
              <WizardHeading title="На чём основан проект?" description="Нужен хотя бы один документ, ZIP или публичный репозиторий. Из репозитория читаются только README и документация." />
              <label className="field defense-title-field" htmlFor="defense-project-title"><span>Название проекта</span><input ref={titleInput} id="defense-project-title" className="input" value={title} maxLength={140} aria-invalid={Boolean(fieldErrors.title)} aria-describedby={fieldErrors.title ? "defense-project-title-error" : undefined} onChange={(event) => { setTitle(event.target.value); setFieldErrors((current) => ({ ...current, title: undefined })); }} placeholder="Например: сервис планирования StudyFlow" autoFocus /></label>
              {fieldErrors.title ? <p className="defense-field-error" id="defense-project-title-error">{fieldErrors.title}</p> : null}
              <div className="defense-source-grid">
                <label className="defense-file-drop">
                  <FileArchive aria-hidden="true" />
                  <strong>Документ или ZIP проекта</strong>
                  <span>TXT, MD, PDF, DOCX, PPTX или ZIP</span>
                  <input type="file" multiple accept=".txt,.md,.pdf,.docx,.pptx,.zip" onChange={addProjectFiles} />
                </label>
                <label className="field defense-repository-field" htmlFor="defense-repository"><span><GitBranch size={17} aria-hidden="true" /> Публичный GitHub / GitLab</span><input id="defense-repository" className="input" type="url" value={repositoryUrl} aria-invalid={Boolean(fieldErrors.repository)} aria-describedby={fieldErrors.repository ? "defense-repository-error" : undefined} onChange={(event) => { setRepositoryUrl(event.target.value); setFieldErrors((current) => ({ ...current, repository: undefined })); }} placeholder="https://github.com/team/project" /></label>
              </div>
              {fieldErrors.repository ? <p className="defense-field-error" id="defense-repository-error">{fieldErrors.repository}</p> : null}
              <FileList files={projectFiles} onRemove={(index) => setProjectFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} />
              {fieldErrors.projectFiles ? <p className="defense-field-error">{fieldErrors.projectFiles}</p> : null}
              {savedSources.length ? <SavedSourceList sources={savedSources} busy={busy} onToggleIncluded={setSavedSourceIncluded} /> : null}
            </motion.div>
          ) : null}

          {step === 2 ? (
            <motion.div className="defense-pane" key="materials" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
              <WizardHeading title="Добавьте ТЗ и визуальные материалы" description="Роль каждого файла помогает отличить доказательства от референсов и декора." />
              <label className="defense-material-add">
                <Plus aria-hidden="true" size={19} />
                <span><strong>Добавить материалы</strong><small>ТЗ, PPTX-референс, скриншоты, логотипы или изображения</small></span>
                <input type="file" multiple accept=".txt,.md,.pdf,.docx,.pptx,.zip,.png,.jpg,.jpeg,.webp" onChange={addMaterials} />
              </label>
              {materials.length ? (
                <div className="defense-material-list" aria-label="Материалы проекта">
                  {materials.map((item) => (
                    <div className="defense-material-item" key={item.id}>
                      <FileImage aria-hidden="true" size={19} />
                      <span><strong>{item.file.name}</strong><small>{formatFileSize(item.file.size)}</small></span>
                      <Select value={item.role} ariaLabel={`Роль файла ${item.file.name}`} options={materialRoles} onValueChange={(role) => setMaterials((current) => current.map((entry) => entry.id === item.id ? { ...entry, role: role as UploadSourceRole } : entry))} />
                      <button type="button" aria-label={`Удалить ${item.file.name}`} onClick={() => setMaterials((current) => current.filter((entry) => entry.id !== item.id))}><Trash2 size={17} aria-hidden="true" /></button>
                    </div>
                  ))}
                </div>
              ) : <div className="defense-empty-inline"><Archive aria-hidden="true" /><span>Дополнительные материалы необязательны. При отсутствии ТЗ будет применён встроенный пресет.</span></div>}
              {fieldErrors.materials ? <p className="defense-field-error">{fieldErrors.materials}</p> : null}
              <p className="defense-upload-hint">До {DEFENSE_UPLOAD_MAX_FILES} файлов за раз, не более {formatFileSize(DEFENSE_UPLOAD_MAX_FILE_BYTES)} каждый. SVG не поддерживается.</p>
              <label className="defense-consent"><input type="checkbox" checked={allowWebImages} onChange={(event) => { setAllowWebImages(event.target.checked); setConfigDirty(true); }} /><span><strong>Разрешить искать иллюстрации в интернете</strong><small>Только для оформления. Интернет не используется как источник фактов о проекте.</small></span></label>
            </motion.div>
          ) : null}

          {step === 3 ? (
            <motion.div className="defense-pane" key="author" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
              <WizardHeading title="Данные для титульного слайда" description="Все поля необязательны. Пропуски останутся заметными заполнителями — AI не будет угадывать имена и организацию." />
              <div className="defense-author-grid">
                <AuthorField label="ФИО" field="fullName" profile={authorProfile} onChange={(profile) => { setAuthorProfile(profile); setConfigDirty(true); }} />
                <AuthorField label={defenseType === "hackathon" ? "Команда" : "Учебное заведение"} field={defenseType === "hackathon" ? "teamName" : "institution"} profile={authorProfile} onChange={(profile) => { setAuthorProfile(profile); setConfigDirty(true); }} />
                {defenseType === "hackathon" ? <AuthorField label="Название мероприятия" field="eventName" profile={authorProfile} onChange={(profile) => { setAuthorProfile(profile); setConfigDirty(true); }} /> : <><AuthorField label="Кафедра" field="department" profile={authorProfile} onChange={(profile) => { setAuthorProfile(profile); setConfigDirty(true); }} /><AuthorField label="Группа" field="group" profile={authorProfile} onChange={(profile) => { setAuthorProfile(profile); setConfigDirty(true); }} /><AuthorField label="Руководитель" field="supervisor" profile={authorProfile} onChange={(profile) => { setAuthorProfile(profile); setConfigDirty(true); }} /></>}
                <AuthorField label="Город" field="city" profile={authorProfile} onChange={(profile) => { setAuthorProfile(profile); setConfigDirty(true); }} />
                <AuthorField label="Год" field="year" profile={authorProfile} onChange={(profile) => { setAuthorProfile(profile); setConfigDirty(true); }} />
              </div>
              {fieldErrors.authorProfile ? <p className="defense-field-error">{fieldErrors.authorProfile}</p> : null}
              <div className="defense-placeholder-note"><ShieldCheck aria-hidden="true" /><div><strong>Только подтверждённые данные</strong><span>Если значение не указано в материалах и не введено здесь, в презентации появится заполнитель для ручной проверки.</span></div></div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        {draftReady ? (
          <div className="defense-draft-ready" role="status">
            <Check aria-hidden="true" />
            <div><strong>{draftDirty ? "Есть несохранённые изменения" : "Черновик и материалы сохранены"}</strong><span>{draftDirty ? "Сохраните изменения перед запуском AI-анализа: в него попадёт только сохранённая версия материалов и настроек." : "AI ещё не запускался. Следующий шаг извлечёт факты и требования для вашей проверки."}</span></div>
            <Dialog>
              <DialogTrigger asChild><Button type="button" disabled={analysisBusy || draftDirty || loadingDraft}><Rocket size={18} aria-hidden="true" />Перейти к AI-анализу</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Запустить анализ материалов?</DialogTitle><DialogDescription>AI извлечёт требования, подтверждённые факты, материалы и возможные противоречия. Презентация пока не создаётся.</DialogDescription></DialogHeader>
                <div className="ai-cost-warning"><ShieldCheck aria-hidden="true" /><div><strong>Возможен расход баланса AI-провайдера</strong><span>Проверьте баланс Yandex/OpenAI. Запрос можно не запускать — черновик уже сохранён.</span></div></div>
                <div className="ui-dialog-actions"><DialogClose asChild><Button variant="secondary" type="button">Вернуться без запуска</Button></DialogClose><Button type="button" onClick={startAnalysis} disabled={analysisBusy || draftDirty}>{analysisBusy ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}Запустить анализ</Button></div>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}
        <div className="defense-wizard-actions">
          <Button variant="secondary" type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || busy || loadingDraft}>Назад</Button>
          {step < 3 ? <Button type="button" onClick={goNext} disabled={busy || loadingDraft}>Продолжить</Button> : <Button type="button" onClick={saveDraft} disabled={busy || loadingDraft || !creationAllowed}>{busy ? <LoaderCircle className="spin" size={18} /> : <FileText size={18} />}{busy ? "Сохраняем…" : draftId ? "Сохранить изменения" : "Сохранить черновик"}</Button>}
        </div>
      </div>
    </section>
  );
}

function WizardHeading({ title, description }: { title: string; description: string }) {
  return <header className="defense-pane-heading"><h2>{title}</h2><p>{description}</p></header>;
}

function Choice({ checked, title, description, onClick, onKeyDown }: { checked: boolean; title: string; description: string; onClick: () => void; onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void }) {
  return <button className={checked ? "defense-choice defense-choice-active" : "defense-choice"} type="button" role="radio" tabIndex={checked ? 0 : -1} aria-checked={checked} onClick={onClick} onKeyDown={onKeyDown}><span>{checked ? <Check size={15} aria-hidden="true" /> : null}</span><div><strong>{title}</strong><small>{description}</small></div></button>;
}

function FileList({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (!files.length) return null;
  return <div className="defense-file-list" aria-label="Файлы проекта">{files.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}`}><FileText size={18} aria-hidden="true" /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><button type="button" aria-label={`Удалить ${file.name}`} onClick={() => onRemove(index)}><Trash2 size={17} aria-hidden="true" /></button></div>)}</div>;
}

function SavedSourceList({ sources, busy, onToggleIncluded }: { sources: SavedDefenseSource[]; busy: boolean; onToggleIncluded: (sourceId: string, included: boolean) => void }) {
  const activeProjectSourceCount = sources.filter((source) => source.included !== false && isProjectSourceRole(source.role)).length;
  return (
    <section className="defense-saved-sources" aria-labelledby="defense-saved-sources-title">
      <header><strong id="defense-saved-sources-title">Сохранённые материалы</strong><span>Исключённые файлы останутся в черновике, но не попадут в повторный анализ.</span></header>
      <div>
        {sources.map((source) => {
          const included = source.included !== false;
          const isLastProjectSource = included && isProjectSourceRole(source.role) && activeProjectSourceCount <= 1;
          return <article key={source.id} className={included ? "defense-saved-source" : "defense-saved-source defense-saved-source-excluded"}><FileArchive size={17} aria-hidden="true" /><span><strong>{source.label}</strong><small>{sourceRoleLabel(source.role)}</small></span><Button variant="secondary" size="sm" type="button" aria-pressed={included} disabled={busy || isLastProjectSource} title={isLastProjectSource ? "Нужен хотя бы один исходный материал проекта" : undefined} onClick={() => onToggleIncluded(source.id, !included)}>{included ? "Не использовать" : "Вернуть"}</Button></article>;
        })}
      </div>
    </section>
  );
}

function AuthorField({ label, field, profile, onChange }: { label: string; field: keyof DefenseAuthorProfile; profile: DefenseAuthorProfile; onChange: (profile: DefenseAuthorProfile) => void }) {
  const maxLength = authorFieldLimits[field];
  const isYear = field === "year";
  return <label className="field"><span>{label}</span><input className="input" value={profile[field] || ""} maxLength={maxLength} inputMode={isYear ? "numeric" : undefined} pattern={isYear ? "[0-9]{4}" : undefined} onChange={(event) => onChange({ ...profile, [field]: event.target.value })} /></label>;
}

function suggestedRole(file: File): UploadSourceRole {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pptx")) return "style_reference";
  if (/logo|логотип/.test(name)) return "logo";
  if (/тз|tz|spec|requirement/.test(name)) return "technical_spec";
  if (/\.png$|\.jpe?g$|\.webp$/.test(name)) return "screenshot";
  return "defense_spec";
}

function uniqueFiles(files: File[]) {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prepareDefenseFiles(files: File[], supportedExtensions: ReadonlySet<string>, existingCount: number) {
  const unique = uniqueFiles(files);
  if (existingCount + unique.length > DEFENSE_UPLOAD_MAX_FILES) {
    return { files: [], error: `За один раз можно добавить не больше ${DEFENSE_UPLOAD_MAX_FILES} файлов.` };
  }
  const unsupported = unique.find((file) => !supportedExtensions.has(fileExtension(file.name)));
  if (unsupported) {
    return { files: [], error: `Файл «${unsupported.name}» имеет неподдерживаемый формат.` };
  }
  const oversized = unique.find((file) => file.size > DEFENSE_UPLOAD_MAX_FILE_BYTES);
  if (oversized) {
    return { files: [], error: `Файл «${oversized.name}» больше допустимого размера ${formatFileSize(DEFENSE_UPLOAD_MAX_FILE_BYTES)}.` };
  }
  return { files: unique, error: "" };
}

function fileExtension(name: string) {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

function isPublicRepositoryUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    const pathParts = url.pathname.split("/").filter(Boolean);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && (hostname === "github.com" || hostname === "gitlab.com")
      && pathParts.length >= 2
      && (hostname !== "github.com" || pathParts.length === 2);
  } catch {
    return false;
  }
}

function isProjectSourceRole(role: SourceRole | null | undefined) {
  return role === "project_document" || role === "repository_document" || role === "archive_document";
}

function sourceRoleLabel(role: SourceRole | null | undefined) {
  const labels: Record<string, string> = {
    project_document: "Описание проекта",
    technical_spec: "Техническое ТЗ",
    defense_spec: "ТЗ защиты",
    style_reference: "Референс стиля",
    screenshot: "Скриншот",
    logo: "Логотип",
    supporting_image: "Иллюстрация",
    repository_document: "Документация репозитория",
    archive_document: "Документ из ZIP",
    web_image: "Интернет-иллюстрация",
  };
  return labels[role || ""] || "Материал";
}

function validateAuthorProfile(profile: DefenseAuthorProfile) {
  for (const [field, maxLength] of Object.entries(authorFieldLimits) as Array<[keyof DefenseAuthorProfile, number]>) {
    const value = profile[field]?.trim();
    if (value && value.length > maxLength) return `Поле «${authorFieldLabel(field)}» не должно быть длиннее ${maxLength} символов.`;
  }
  if (profile.year && (!/^\d{4}$/.test(profile.year) || Number(profile.year) < 1900 || Number(profile.year) > 2100)) {
    return "Укажите год в формате YYYY: от 1900 до 2100.";
  }
  return "";
}

function authorFieldLabel(field: keyof DefenseAuthorProfile) {
  return ({ fullName: "ФИО", institution: "учебное заведение", department: "кафедра", group: "группа", supervisor: "руководитель", city: "город", year: "год", teamName: "команда", eventName: "название мероприятия" } as Record<keyof DefenseAuthorProfile, string>)[field];
}

function selectRadioWithArrow<T extends string>(event: KeyboardEvent<HTMLButtonElement>, options: readonly T[], onChange: (value: T) => void) {
  const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (!direction) return;
  event.preventDefault();
  const controls = event.currentTarget.closest("fieldset")?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  const currentIndex = controls ? Array.from(controls).indexOf(event.currentTarget) : -1;
  const nextIndex = (Math.max(currentIndex, 0) + direction + options.length) % options.length;
  onChange(options[nextIndex]);
  controls?.[nextIndex]?.focus();
}

function createIdempotencyKey(prefix: string) {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function userError(error: unknown, fallback: string) {
  if (error instanceof ApiClientError && /[А-Яа-яЁё]/.test(error.message)) return error.message;
  return fallback;
}

function saveDraftFallback(
  stage: "create" | "metadata" | "config" | "repository" | "uploads",
  projectCreated: boolean,
) {
  if (stage === "metadata" || stage === "config") {
    return "Черновик сохранён, но часть настроек не обновилась. Обновите страницу и повторите попытку.";
  }
  if (stage === "repository") {
    return "Черновик создан, но ссылку на репозиторий сохранить не удалось. Повторите попытку.";
  }
  if (stage === "uploads" || projectCreated) {
    return "Черновик создан, но не все материалы загрузились. Повторите попытку.";
  }
  return "Не получилось создать черновик защиты. Попробуйте ещё раз.";
}
