import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page hero">
      <section>
        <p className="status">Промпт - файлы - план - редактор - экспорт</p>
        <h1>Собери учебную презентацию и рассказ к ней</h1>
        <p className="lead">
          StudyDeck AI превращает тему, конспект, PDF или статью в понятный план,
          слайды, заметки для выступления и речь по каждому слайду.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/new">Начать презентацию</Link>
          <Link className="ghost" href="/pricing">Посмотреть тарифы</Link>
        </div>
      </section>
      <section className="preview" aria-label="Рабочий процесс">
        {[
          ["01", "Опиши тему и требования"],
          ["02", "Добавь PDF, DOCX, PPTX, TXT или конспект"],
          ["03", "Проверь план и структуру"],
          ["04", "Отредактируй слайды, заметки и рассказ"],
          ["05", "Скачай PDF или PPTX"],
        ].map(([number, text]) => (
          <div className="preview-item" key={number}>
            <span>{number}</span>
            <strong>{text}</strong>
          </div>
        ))}
      </section>
    </main>
  );
}
