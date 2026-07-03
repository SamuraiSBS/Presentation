import Link from "next/link";
import { ArrowRight, FileText, Mic2, MonitorUp, PencilRuler, Presentation } from "lucide-react";

const workflow = [
  { icon: Presentation, text: "Опиши тему и требования" },
  { icon: FileText, text: "Добавь PDF, DOCX, PPTX, TXT или конспект" },
  { icon: Mic2, text: "Проверь текст выступления" },
  { icon: PencilRuler, text: "Отредактируй слайды и заметки" },
  { icon: MonitorUp, text: "Скачай PDF или PPTX" },
];

export default function HomePage() {
  return (
    <main className="page hero">
      <section className="hero-copy">
        <p className="status">Промпт - файлы - план - редактор - экспорт</p>
        <h1>Собери учебную презентацию и рассказ к ней</h1>
        <p className="lead">
          StudyDeck AI превращает тему, конспект, PDF или статью в понятный план,
          слайды, заметки для выступления и речь по каждому слайду.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/new">Начать презентацию <ArrowRight aria-hidden="true" size={19} /></Link>
          <Link className="ghost" href="/pricing">Посмотреть тарифы</Link>
        </div>
      </section>
      <section className="preview" aria-label="Рабочий процесс">
        {workflow.map(({ icon: Icon, text }) => (
          <div className="preview-item" key={text}>
            <span><Icon aria-hidden="true" size={20} /></span>
            <strong>{text}</strong>
          </div>
        ))}
      </section>
    </main>
  );
}
