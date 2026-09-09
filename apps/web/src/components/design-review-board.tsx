"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, RefreshCw, WandSparkles } from "lucide-react";
import { type DesignReview } from "@studydeck/shared";
import { ReadonlyCanvasElement } from "@/components/project-editor/editor-canvas";
import { Button } from "@/components/ui/button";

type Props = { initialReview: DesignReview; title: string; accessRole: string };

export function DesignReviewBoard({ initialReview, title, accessRole }: Props) {
  const router = useRouter();
  const [review, setReview] = useState(initialReview);
  const [selectedSlideId, setSelectedSlideId] = useState(initialReview.document.slides[0]?.id || "");
  const [selectedVersion, setSelectedVersion] = useState(1);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = accessRole !== "viewer" && review.status === "active";
  const candidates = review.candidates.filter((candidate) => candidate.slideId === selectedSlideId);
  const candidate = candidates.find((item) => item.version === selectedVersion) || candidates.at(-1);
  const slide = review.document.slides.find((item) => item.id === selectedSlideId);

  async function reload() {
    const response = await fetch(`/api/projects/${review.projectId}/design-review`, { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    setReview(await response.json());
  }
  useEffect(() => {
    if (!review.candidates.some((item) => item.status === "regenerating")) return;
    const timer = window.setInterval(() => { void reload().catch(() => undefined); }, 2500);
    return () => window.clearInterval(timer);
  }, [review.candidates]);
  async function approve() {
    if (!candidate) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${review.projectId}/design-review/${candidate.slideId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: review.revision, version: candidate.version }) });
      if (!response.ok) throw new Error(await response.text());
      const project = await response.json() as { status?: string; revision?: number };
      if (project.status === "ready") { router.replace(`/projects/${review.projectId}/editor`); return; }
      await reload();
    } catch { setError("Не удалось сохранить решение. Обновите доску и повторите попытку."); }
    finally { setBusy(false); }
  }
  async function regenerate() {
    if (!candidate || comment.trim().length < 3) { setError("Опишите, что нужно изменить в дизайне (минимум 3 символа)."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${review.projectId}/design-review/${candidate.slideId}/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: review.revision, comment: comment.trim() }) });
      if (!response.ok) throw new Error(await response.text());
      const created = await response.json() as { version: number };
      await reload(); setSelectedVersion(created.version); setComment("");
    } catch { setError("Не удалось создать новый вариант. Утверждённые слайды не изменены."); }
    finally { setBusy(false); }
  }

  return <section className="design-review-board">
    <header className="design-review-header"><div><span className="status">Дизайн слайдов</span><h1>{title}</h1><p>Утвердите каждый слайд. Текст и речь на этом этапе зафиксированы.</p></div><Button variant="ghost" onClick={() => void reload()} disabled={busy}><RefreshCw size={17} />Обновить</Button></header>
    <div className="design-review-progress"><strong>{new Set(review.candidates.filter((item) => item.status === "approved").map((item) => item.slideId)).size} из {review.document.slides.length}</strong><span>слайдов утверждено</span></div>
    <div className="design-review-layout">
      <nav className="design-review-rail" aria-label="Слайды для проверки">{review.document.slides.map((item) => {
        const active = item.id === selectedSlideId; const approved = review.candidates.some((candidate) => candidate.slideId === item.id && candidate.status === "approved");
        return <button className={`design-review-thumb${active ? " active" : ""}`} key={item.id} onClick={() => { setSelectedSlideId(item.id); setSelectedVersion(review.candidates.filter((candidate) => candidate.slideId === item.id && candidate.status === "approved")[0]?.version || review.candidates.find((candidate) => candidate.slideId === item.id)?.version || 1); }} type="button"><span>{item.order}</span><strong>{item.title}</strong><small>{approved ? "Утверждён" : "Ожидает решения"}</small></button>;
      })}</nav>
      <div className="design-review-stage">{slide && candidate ? <div className="design-review-canvas" style={{ width: candidate.canvas.width, height: candidate.canvas.height, background: candidate.canvas.background }}>
        {candidate.canvas.elements.map((element) => <ReadonlyCanvasElement element={element} key={element.id} onSelect={() => undefined} />)}
      </div> : <p>Выберите слайд.</p>}</div>
      <aside className="design-review-actions"><h2>Слайд {slide?.order}</h2><p>{candidate?.status === "approved" ? "Этот вариант утверждён." : candidate?.status === "regenerating" ? "AI создаёт новый вариант. Утверждённые слайды не меняются." : candidate?.status === "failed" ? "Этот вариант не удалось создать. Выберите другую версию или повторите запрос." : "Выберите вариант или попросите переделать дизайн."}</p>
        {candidates.length > 1 ? <label className="field">Версия<select className="input" value={candidate?.version || ""} onChange={(event) => setSelectedVersion(Number(event.target.value))}>{candidates.map((item) => <option key={item.id} value={item.version}>Версия {item.version}</option>)}</select></label> : null}
        {editable ? <><Button type="button" onClick={approve} disabled={busy || !candidate || candidate.status === "regenerating" || candidate.status === "failed"}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Утвердить дизайн</Button><label className="field">Комментарий для нового варианта<textarea className="textarea" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например: сделайте схему спокойнее и добавьте больше воздуха" /></label><Button type="button" variant="secondary" onClick={regenerate} disabled={busy || !candidate || candidate.status === "regenerating"}><WandSparkles size={17} />Переделать дизайн</Button></> : null}
        {candidate?.comment ? <p className="design-review-comment">Последний комментарий: {candidate.comment}</p> : null}{error ? <p className="form-error">{error}</p> : null}
      </aside>
    </div>
  </section>;
}
