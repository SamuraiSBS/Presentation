import Link from "next/link";
import { ArrowRight, FileText, Mic2, MonitorUp, PencilRuler, Presentation } from "lucide-react";
import { MotionList, MotionListItem } from "@/components/motion/motion-list";

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
      <MotionList className="hero-copy" as="section">
        <MotionListItem index={0}><p className="status">Тема, материалы, текст, слайды, готовый файл</p></MotionListItem>
        <MotionListItem index={1}><h1>Собери презентацию, с которой легко выступать</h1></MotionListItem>
        <MotionListItem index={2}><p className="lead">
          Напиши тему или добавь свои материалы. StudyDeck AI подготовит слайды,
          заметки и связный текст, который можно спокойно рассказать на паре или защите.
        </p></MotionListItem>
        <MotionListItem index={3}><div className="hero-actions">
          <Link className="button hero-primary-action" href="/new">Создать презентацию <ArrowRight aria-hidden="true" size={19} /></Link>
          <Link className="ghost" href="/pricing">Выбрать тариф</Link>
        </div></MotionListItem>
      </MotionList>
      <MotionList className="preview" as="section" aria-label="Рабочий процесс">
        {workflow.map(({ icon: Icon, text }, index) => (
          <MotionListItem className="preview-item" index={index} key={text}>
            <span><Icon aria-hidden="true" size={20} /></span>
            <strong>{text}</strong>
          </MotionListItem>
        ))}
      </MotionList>
    </main>
  );
}
