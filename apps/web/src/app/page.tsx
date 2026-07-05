import Link from "next/link";
import { ArrowRight, FileText, Mic2, MonitorUp, PencilRuler, Presentation } from "lucide-react";

const workflow = [
  { icon: Presentation, text: "Расскажи, о чём будешь выступать" },
  { icon: FileText, text: "Добавь конспект, PDF, DOCX, PPTX или TXT" },
  { icon: Mic2, text: "Прочитай и поправь текст выступления" },
  { icon: PencilRuler, text: "Настрой слайды и заметки" },
  { icon: MonitorUp, text: "Скачай готовую работу в PDF или PPTX" },
];

export default function HomePage() {
  return (
    <main className="page hero">
      <section className="hero-copy">
        <p className="status">Тема, материалы, текст, слайды, готовый файл</p>
        <h1>Собери презентацию, с которой легко выступать</h1>
        <p className="lead">
          Напиши тему или добавь свои материалы. StudyDeck AI подготовит слайды,
          заметки и связный текст, который можно спокойно рассказать на паре или защите.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/new">Создать презентацию <ArrowRight aria-hidden="true" size={19} /></Link>
          <Link className="ghost" href="/pricing">Выбрать тариф</Link>
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
