"use client";

import { useState } from "react";

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
  const document = project.presentation?.document;

  async function requestExport(type: "pdf" | "pptx") {
    const response = await fetch(`/api/projects/${project.id}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (response.ok) setExports([await response.json(), ...exports]);
  }

  async function download(item: ExportItem) {
    const response = await fetch(`/api/projects/${project.id}/exports/${item.id}/download-url`);
    const result = await response.json();
    if (result.url) window.location.href = result.url;
  }

  return (
    <section className="panel">
      <span className="status">{project.status}</span>
      <h1 className="page-title" style={{ fontSize: 48 }}>Экспорт</h1>
      <p className="lead">
        {project.title}: {document?.slides?.length || 0} слайдов.
      </p>
      <div className="actions">
        <button className="button" type="button" onClick={() => requestExport("pdf")}>Подготовить PDF</button>
        <button className="ghost" type="button" onClick={() => requestExport("pptx")}>Подготовить PPTX</button>
      </div>
      <div style={{ height: 20 }} />
      <div className="project-list">
        {exports.map((item) => (
          <div className="card" key={item.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{item.type.toUpperCase()}</strong>
              <span className="status">{item.status}</span>
            </div>
            <p className="muted">{item.objectKey || "Файл появится после обработки worker."}</p>
            {item.status === "ready" ? <button className="ghost" type="button" onClick={() => download(item)}>Скачать</button> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
