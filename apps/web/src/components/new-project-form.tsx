"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function NewProjectForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const prompt = String(form.get("prompt") || "").trim();

    try {
      const createResponse = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          prompt,
          scenario: form.get("scenario"),
          level: form.get("level"),
          mode: form.get("mode"),
          slideCount: Number(form.get("slideCount") || 10),
        }),
      });
      if (!createResponse.ok) throw new Error(await createResponse.text());
      const project = await createResponse.json();

      const files = form.getAll("files").filter((item) => item instanceof File && item.size > 0);
      if (files.length) {
        const uploadBody = new FormData();
        files.forEach((file) => uploadBody.append("files", file));
        const uploadResponse = await fetch(`/api/projects/${project.id}/uploads`, { method: "POST", body: uploadBody });
        if (!uploadResponse.ok) throw new Error(await uploadResponse.text());
      }

      const generateResponse = await fetch(`/api/projects/${project.id}/generate`, { method: "POST" });
      if (!generateResponse.ok) throw new Error(await generateResponse.text());
      router.push(`/projects/${project.id}/editor`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать презентацию");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form panel" onSubmit={handleSubmit}>
      <label className="field">
        Название
        <input className="input" name="title" defaultValue="Искусственный интеллект в образовании" required />
      </label>
      <label className="field">
        Промпт
        <textarea
          className="textarea"
          name="prompt"
          defaultValue={'Сделай презентацию на 10 слайдов по теме "Искусственный интеллект в образовании". Объясни простыми словами, добавь источники, заметки и рассказ для выступления.'}
          required
        />
      </label>
      <div className="grid">
        <label className="field">
          Сценарий
          <select className="select" name="scenario" defaultValue="school_report">
            <option value="school_report">Школьный доклад</option>
            <option value="student_seminar">Студенческий семинар</option>
            <option value="project_defense">Защита проекта</option>
            <option value="article_presentation">По статье</option>
            <option value="lesson">Урок</option>
          </select>
        </label>
        <label className="field">
          Уровень
          <select className="select" name="level" defaultValue="8-11 класс">
            <option>5-7 класс</option>
            <option>8-11 класс</option>
            <option>Колледж</option>
            <option>Университет</option>
          </select>
        </label>
        <label className="field">
          Слайдов
          <select className="select" name="slideCount" defaultValue="10">
            <option>6</option>
            <option>8</option>
            <option>10</option>
            <option>12</option>
            <option>14</option>
          </select>
        </label>
      </div>
      <label className="field">
        Режим
        <select className="select" name="mode" defaultValue="with_sources">
          <option value="fast_draft">Быстрый черновик</option>
          <option value="with_sources">С источниками</option>
          <option value="explain_simpler">Объяснить проще</option>
        </select>
      </label>
      <label className="field">
        Материалы
        <input className="input" name="files" type="file" accept=".pdf,.docx,.pptx,.txt,.md,.csv" multiple />
      </label>
      {error ? <p className="muted">{error}</p> : null}
      <button className="button" type="submit" disabled={busy}>{busy ? "Создаем..." : "Создать и запустить генерацию"}</button>
    </form>
  );
}
