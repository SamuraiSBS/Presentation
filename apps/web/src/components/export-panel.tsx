"use client";

import { useState } from "react";
import { Download, FileDown, FileText, LoaderCircle, Presentation } from "lucide-react";

type ExportItem = { id: string; type: string; status: string; objectKey?: string | null };
type ProjectPayload = {
  id: string;
  title: string;
  status: string;
  exports?: ExportItem[];
  presentation?: { document?: { slides?: unknown[] } } | null;
};

export function ExportPanel({ project }: { project: ProjectPayload }) {
  const [exports, setExports] = useState(project.exports || []);
  const [busyType, setBusyType] = useState<"pdf" | "pptx" | null>(null);
  const document = project.presentation?.document;

  async function requestExport(type: "pdf" | "pptx") {
    setBusyType(type);
    try {
      const response = await fetch(`/api/projects/${project.id}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (response.ok) setExports([await response.json(), ...exports]);
    } finally {
      setBusyType(null);
    }
  }

  function download(item: ExportItem) {
    window.location.href = `/api/projects/${project.id}/exports/${item.id}/download`;
  }

  return (
    <section className="panel">
      <span className={`status status-${project.status}`}>{statusLabel(project.status)}</span>
      <h1 className="page-title">Экспорт</h1>
      <p className="lead">
        {project.title}: {document?.slides?.length || 0} слайдов.
      </p>
      <div className="actions">
        <button className="button" type="button" onClick={() => requestExport("pdf")} disabled={busyType !== null}>{busyType === "pdf" ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <FileText aria-hidden="true" size={18} />}Подготовить PDF</button>
        <button className="ghost" type="button" onClick={() => requestExport("pptx")} disabled={busyType !== null}>{busyType === "pptx" ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Presentation aria-hidden="true" size={18} />}Подготовить PPTX</button>
      </div>
      <div style={{ height: 20 }} />
      <div className="project-list">
        {exports.map((item) => (
          <div className="card export-item" key={item.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{item.type.toUpperCase()}</strong>
              <span className={`status status-${item.status}`}>{statusLabel(item.status)}</span>
            </div>
            <p className="muted">{item.objectKey || "Файл появится после обработки фоновой задачей."}</p>
            {item.status === "ready" ? <button className="ghost" type="button" onClick={() => download(item)}><Download aria-hidden="true" size={18} />Скачать</button> : <span className="export-pending"><FileDown aria-hidden="true" size={18} />Файл готовится в фоне</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Черновик",
    queued: "В очереди",
    active: "Обрабатывается",
    generating: "Создаётся",
    completed: "Готово",
    ready: "Готово",
    failed: "Ошибка",
  };
  return labels[status] || status;
}
