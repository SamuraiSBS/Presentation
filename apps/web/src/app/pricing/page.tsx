import Link from "next/link";
import { CheckoutButton } from "@/components/checkout-button";

export default function PricingPage() {
  const plans = [
    ["Бесплатный", "$0", "3 презентации в месяц", "До 10 слайдов", "Экспорт в PDF"],
    ["Студенческий", "$9", "60 презентаций в месяц", "До 14 слайдов", "PDF и PPTX"],
    ["Для преподавателя", "$19", "200 презентаций в месяц", "До 20 слайдов", "Приоритетная очередь"],
  ];

  return (
    <main className="page">
      <h1 className="page-title">Тарифы</h1>
      <p className="lead">Бесплатный тариф и платные планы для студентов и преподавателей. Оплата и управление подпиской подключаются через платёжный сервис.</p>
      <section className="grid">
        {plans.map(([name, price, ...features]) => (
          <article className="card" key={name}>
            <h2>{name}</h2>
            <div className="price"><strong>{price}</strong><span className="muted">/мес.</span></div>
            {features.map((feature) => <p className="muted" key={feature}>{feature}</p>)}
            {name === "Бесплатный" ? <Link className="ghost" href="/new">Начать бесплатно</Link> : <CheckoutButton plan={name === "Для преподавателя" ? "pro" : "student"} />}
          </article>
        ))}
      </section>
    </main>
  );
}
