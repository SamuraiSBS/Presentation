const timelineEvents = [
  { time: "0:00", duration: "PT0M", title: "Написал тему", detail: "Коротко формулируешь, о чём будет выступление." },
  { time: "0:40", duration: "PT40S", title: "Готов план", detail: "Появляется понятная логика будущего рассказа." },
  { time: "1:30", duration: "PT1M30S", title: "Подобраны материалы", detail: "Тема обрастает фактами, примерами и опорами." },
  { time: "3:20", duration: "PT3M20S", title: "Подготовлена речь", detail: "Каждый слайд получает связный текст выступления." },
  { time: "4:48", duration: "PT4M48S", title: "Собраны слайды", detail: "Структура превращается в цельную презентацию." },
  { time: "5:00", duration: "PT5M", title: "Можно редактировать или скачивать", detail: "Проверь детали и подготовь финальный файл." },
] as const;

export function FiveMinuteTimeline() {
  return (
    <section className="landing-timeline-section" id="how-it-works" aria-labelledby="landing-timeline-title">
      <header className="landing-section-heading landing-timeline-heading">
        <p className="landing-section-label">Как это работает</p>
        <h2 id="landing-timeline-title">Пять минут, чтобы выйти из режима «надо было начать раньше».</h2>
        <p>Это демонстрационный маршрут: он показывает, какой комплект ты получаешь от одной темы.</p>
      </header>

      <ol className="landing-timeline" aria-label="Путь от темы до готовой презентации">
        {timelineEvents.map((event, index) => (
          <li className="landing-timeline-item" key={event.time}>
            <div className="landing-timeline-marker" aria-hidden="true">
              <span>{index + 1}</span>
            </div>
            <div className="landing-timeline-time">
              <time dateTime={event.duration}>{event.time}</time>
            </div>
            <div className="landing-timeline-copy">
              <h3>{event.title}</h3>
              <p>{event.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
