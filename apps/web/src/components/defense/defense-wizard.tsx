"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
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
  UploadSourceRole,
} from "@studydeck/shared";
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

type MaterialFile = {
  id: string;
  file: File;
  role: UploadSourceRole;
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
  const [repositorySaved, setRepositorySaved] = useState(false);
  const [uploadsSaved, setUploadsSaved] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [error, setError] = useState("");

  const hasProjectSource = projectFiles.length > 0 || Boolean(repositoryUrl.trim());
  const cleanAuthorProfile = useMemo(
    () => Object.fromEntries(Object.entries(authorProfile).filter(([, value]) => value?.trim())) as DefenseAuthorProfile,
    [authorProfile],
  );

  function chooseDefenseType(next: DefenseType) {
    setDefenseType(next);
    setTargetSlideCount(Math.min(next === "hackathon" ? 10 : 12, maxSlides));
    setTargetDurationMinutes(next === "hackathon" ? 7 : 10);
  }

  function goNext() {
    setError("");
    if (step === 0) {
      if (targetSlideCount < 4 || targetSlideCount > Math.min(20, maxSlides)) {
        setError(`Укажите от 4 до ${Math.min(20, maxSlides)} слайдов.`);
        return;
      }
      if (targetDurationMinutes < 1 || targetDurationMinutes > 15) {
        setError("Продолжительность должна быть от 1 до 15 минут.");
        return;
      }
    }
    if (step === 1) {
      if (title.trim().length < 2) {
        setError("Укажите название проекта.");
        return;
      }
      if (!hasProjectSource) {
        setError("Добавьте документ, ZIP проекта или ссылку на публичный GitHub/GitLab.");
        return;
      }
      if (repositoryUrl.trim() && !isPublicRepositoryUrl(repositoryUrl)) {
        setError("Нужна публичная ссылка на репозиторий GitHub или GitLab.");
        return;
      }
    }
    setStep((current) => Math.min(3, current + 1));
  }

  function addProjectFiles(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files || []);
    setProjectFiles((current) => uniqueFiles([...current, ...next]));
    setError("");
    event.target.value = "";
  }

  function addMaterials(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files || []).map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      role: suggestedRole(file),
    }));
    setMaterials((current) => [...current, ...next]);
    event.target.value = "";
  }

  async function saveDraft() {
    if (!creationAllowed || !hasProjectSource || title.trim().length < 2) return;
    setBusy(true);
    setError("");
    let saveStage: "create" | "repository" | "uploads" = "create";
    let projectCreated = Boolean(draftId);
    try {
      let projectId = draftId;
      if (!projectId) {
        const project = await apiJson<{ id: string }>("/api/projects/defense", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim(), ...currentConfig() }),
        });
        projectId = project.id;
        setDraftId(projectId);
        projectCreated = true;
      }

      if (repositoryUrl.trim() && !repositorySaved) {
        saveStage = "repository";
        await apiJson(`/api/projects/${projectId}/defense/repositories`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: repositoryUrl.trim() }),
        });
        setRepositorySaved(true);
      }

      if ((projectFiles.length || materials.length) && !uploadsSaved) {
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
        body.append("manifest", JSON.stringify({ files: manifest }));
        await apiJson(`/api/projects/${projectId}/defense/uploads`, { method: "POST", body });
        setUploadsSaved(true);
      }

      setDraftReady(true);
    } catch (cause) {
      setError(userError(cause, saveDraftFallback(saveStage, projectCreated)));
    } finally {
      setBusy(false);
    }
  }

  async function startAnalysis() {
    if (!draftId || !draftReady) return;
    setAnalysisBusy(true);
    setError("");
    try {
      await apiJson(`/api/projects/${draftId}/defense/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmCost: true }),
      });
      router.push(`/projects/${draftId}/defense/review`);
    } catch (cause) {
      setError(userError(cause, "Не получилось запустить анализ. Черновик и материалы сохранены."));
    } finally {
      setAnalysisBusy(false);
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
    <section className="defense-wizard" aria-label="Создание защиты проекта">
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
            disabled={index > step || busy || draftReady}
            onClick={() => setStep(index)}
          >
            <span>{index < step ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : index + 1}</span>
            <strong>{label}</strong>
          </button>
        ))}
      </nav>

      <div className="defense-wizard-surface">
        <AnimatePresence initial={false} mode="wait">
          {step === 0 ? (
            <motion.div className="defense-pane" key="rules" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
              <WizardHeading title="Как проходит защита?" description="Выберите формат и пределы. Тип и режим можно изменить до подтверждения плана." />
              <fieldset className="defense-choice-group">
                <legend>Тип защиты</legend>
                <Choice checked={defenseType === "hackathon"} title="Хакатон" description="Демо, команда и результат · обычно 10 слайдов / 7 минут" onClick={() => chooseDefenseType("hackathon")} />
                <Choice checked={defenseType === "diploma"} title="Диплом" description="Цель, требования, реализация и выводы · обычно 12 слайдов / 10 минут" onClick={() => chooseDefenseType("diploma")} />
              </fieldset>
              <fieldset className="defense-choice-group">
                <legend>Следование ТЗ</legend>
                <Choice checked={complianceMode === "strict"} title="Строго" description="Не хватает факта — показываем заполнитель, а не додумываем." onClick={() => setComplianceMode("strict")} />
                <Choice checked={complianceMode === "adaptive"} title="Адаптивно" description="Обязательное сохраняем, подачу и порядок можно улучшить." onClick={() => setComplianceMode("adaptive")} />
              </fieldset>
              <div className="defense-number-row">
                <label>Слайдов<input className="input" type="number" min={4} max={Math.min(20, maxSlides)} value={targetSlideCount} onChange={(event) => setTargetSlideCount(Number(event.target.value))} /></label>
                <label>Минут<input className="input" type="number" min={1} max={15} value={targetDurationMinutes} onChange={(event) => setTargetDurationMinutes(Number(event.target.value))} /></label>
              </div>
            </motion.div>
          ) : null}

          {step === 1 ? (
            <motion.div className="defense-pane" key="project" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
              <WizardHeading title="На чём основан проект?" description="Нужен хотя бы один документ, ZIP или публичный репозиторий. Из репозитория читаются только README и документация." />
              <label className="field defense-title-field"><span>Название проекта</span><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: сервис планирования StudyFlow" autoFocus /></label>
              <div className="defense-source-grid">
                <label className="defense-file-drop">
                  <FileArchive aria-hidden="true" />
                  <strong>Документ или ZIP проекта</strong>
                  <span>TXT, MD, PDF, DOCX, PPTX или ZIP</span>
                  <input type="file" multiple accept=".txt,.md,.pdf,.docx,.pptx,.zip" onChange={addProjectFiles} />
                </label>
                <label className="field defense-repository-field"><span><GitBranch size={17} aria-hidden="true" /> Публичный GitHub / GitLab</span><input className="input" type="url" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/team/project" /></label>
              </div>
              <FileList files={projectFiles} onRemove={(index) => setProjectFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} />
            </motion.div>
          ) : null}

          {step === 2 ? (
            <motion.div className="defense-pane" key="materials" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
              <WizardHeading title="Добавьте ТЗ и визуальные материалы" description="Роль каждого файла помогает отличить доказательства от референсов и декора." />
              <label className="defense-material-add">
                <Plus aria-hidden="true" size={19} />
                <span><strong>Добавить материалы</strong><small>ТЗ, PPTX-референс, скриншоты, логотипы или изображения</small></span>
                <input type="file" multiple accept=".txt,.md,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.svg" onChange={addMaterials} />
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
              <label className="defense-consent"><input type="checkbox" checked={allowWebImages} onChange={(event) => setAllowWebImages(event.target.checked)} /><span><strong>Разрешить искать иллюстрации в интернете</strong><small>Только для оформления. Интернет не используется как источник фактов о проекте.</small></span></label>
            </motion.div>
          ) : null}

          {step === 3 ? (
            <motion.div className="defense-pane" key="author" variants={fadeSlideVariants} initial="hidden" animate="visible" exit="exit">
              <WizardHeading title="Данные для титульного слайда" description="Все поля необязательны. Пропуски останутся заметными заполнителями — AI не будет угадывать имена и организацию." />
              <div className="defense-author-grid">
                <AuthorField label="ФИО" field="fullName" profile={authorProfile} onChange={setAuthorProfile} />
                <AuthorField label={defenseType === "hackathon" ? "Команда" : "Учебное заведение"} field={defenseType === "hackathon" ? "teamName" : "institution"} profile={authorProfile} onChange={setAuthorProfile} />
                {defenseType === "hackathon" ? <AuthorField label="Название мероприятия" field="eventName" profile={authorProfile} onChange={setAuthorProfile} /> : <><AuthorField label="Кафедра" field="department" profile={authorProfile} onChange={setAuthorProfile} /><AuthorField label="Группа" field="group" profile={authorProfile} onChange={setAuthorProfile} /><AuthorField label="Руководитель" field="supervisor" profile={authorProfile} onChange={setAuthorProfile} /></>}
                <AuthorField label="Город" field="city" profile={authorProfile} onChange={setAuthorProfile} />
                <AuthorField label="Год" field="year" profile={authorProfile} onChange={setAuthorProfile} />
              </div>
              <div className="defense-placeholder-note"><ShieldCheck aria-hidden="true" /><div><strong>Только подтверждённые данные</strong><span>Если значение не указано в материалах и не введено здесь, в презентации появится заполнитель для ручной проверки.</span></div></div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        {draftReady ? (
          <div className="defense-draft-ready" role="status">
            <Check aria-hidden="true" />
            <div><strong>Черновик и материалы сохранены</strong><span>AI ещё не запускался. Следующий шаг извлечёт факты и требования для вашей проверки.</span></div>
            <Dialog>
              <DialogTrigger asChild><Button type="button" disabled={analysisBusy}><Rocket size={18} aria-hidden="true" />Перейти к AI-анализу</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Запустить анализ материалов?</DialogTitle><DialogDescription>AI извлечёт требования, подтверждённые факты, материалы и возможные противоречия. Презентация пока не создаётся.</DialogDescription></DialogHeader>
                <div className="ai-cost-warning"><ShieldCheck aria-hidden="true" /><div><strong>Возможен расход баланса AI-провайдера</strong><span>Проверьте баланс Yandex/OpenAI. Запрос можно не запускать — черновик уже сохранён.</span></div></div>
                <div className="ui-dialog-actions"><DialogClose asChild><Button variant="secondary" type="button">Вернуться без запуска</Button></DialogClose><Button type="button" onClick={startAnalysis} disabled={analysisBusy}>{analysisBusy ? <LoaderCircle className="spin" size={18} /> : <Rocket size={18} />}Запустить анализ</Button></div>
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <div className="defense-wizard-actions">
            <Button variant="secondary" type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || busy}>Назад</Button>
            {step < 3 ? <Button type="button" onClick={goNext}>Продолжить</Button> : <Button type="button" onClick={saveDraft} disabled={busy || !creationAllowed}>{busy ? <LoaderCircle className="spin" size={18} /> : <FileText size={18} />}{busy ? "Сохраняем…" : "Сохранить черновик"}</Button>}
          </div>
        )}
      </div>
    </section>
  );
}

function WizardHeading({ title, description }: { title: string; description: string }) {
  return <header className="defense-pane-heading"><h2>{title}</h2><p>{description}</p></header>;
}

function Choice({ checked, title, description, onClick }: { checked: boolean; title: string; description: string; onClick: () => void }) {
  return <button className={checked ? "defense-choice defense-choice-active" : "defense-choice"} type="button" role="radio" aria-checked={checked} onClick={onClick}><span>{checked ? <Check size={15} aria-hidden="true" /> : null}</span><div><strong>{title}</strong><small>{description}</small></div></button>;
}

function FileList({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (!files.length) return null;
  return <div className="defense-file-list" aria-label="Файлы проекта">{files.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}`}><FileText size={18} aria-hidden="true" /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><button type="button" aria-label={`Удалить ${file.name}`} onClick={() => onRemove(index)}><Trash2 size={17} aria-hidden="true" /></button></div>)}</div>;
}

function AuthorField({ label, field, profile, onChange }: { label: string; field: keyof DefenseAuthorProfile; profile: DefenseAuthorProfile; onChange: (profile: DefenseAuthorProfile) => void }) {
  return <label className="field"><span>{label}</span><input className="input" value={profile[field] || ""} onChange={(event) => onChange({ ...profile, [field]: event.target.value })} /></label>;
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

function isPublicRepositoryUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && ["github.com", "www.github.com", "gitlab.com", "www.gitlab.com"].includes(url.hostname.toLowerCase()) && url.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
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
  stage: "create" | "repository" | "uploads",
  projectCreated: boolean,
) {
  if (stage === "repository") {
    return "Черновик создан, но ссылку на репозиторий сохранить не удалось. Повторите попытку.";
  }
  if (stage === "uploads" || projectCreated) {
    return "Черновик создан, но не все материалы загрузились. Повторите попытку.";
  }
  return "Не получилось создать черновик защиты. Попробуйте ещё раз.";
}
