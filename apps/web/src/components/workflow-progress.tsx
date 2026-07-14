import { Check } from "lucide-react";

const stages = ["Тема", "Объём", "Источники", "Текст", "Слайды", "Экспорт"];

export function WorkflowProgress({ current }: { current: number }) {
  return (
    <ol className="journey-progress" aria-label="Этапы подготовки презентации">
      {stages.map((label, index) => {
        const complete = index < current;
        const active = index === current;
        return (
          <li
            className={`${complete ? "journey-progress-complete" : ""} ${active ? "journey-progress-active" : ""}`}
            aria-current={active ? "step" : undefined}
            key={label}
          >
            <span>{complete ? <Check aria-hidden="true" size={16} /> : index + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
