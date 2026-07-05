import Link from "next/link";
import { CheckoutButton } from "@/components/checkout-button";
import { Check, Sparkles } from "lucide-react";

export default function PricingPage() {
  const plans = [
    ["Бесплатный", "$0", "3 презентации в месяц", "До 10 слайдов", "Экспорт в PDF"],
    ["Студенческий", "$9", "60 презентаций в месяц", "До 14 слайдов", "PDF и PPTX"],
    ["Для преподавателя", "$19", "200 презентаций в месяц", "До 20 слайдов", "Приоритетная очередь"],
  ];

  return (
    <main className="page">
      <h1 className="page-title">Тарифы</h1>
      <p className="lead">Выбери, сколько презентаций тебе нужно. Начать можно бесплатно.</p>
      <section className="grid">
        {plans.map(([name, price, ...features]) => (
          <article className={name === "Студенческий" ? "card pricing-card pricing-card-featured" : "card pricing-card"} key={name}>
            {name === "Студенческий" ? <span className="recommended"><Sparkles aria-hidden="true" size={15} />Для учёбы</span> : null}
            <h2>{name}</h2>
            <div className="price"><strong>{price}</strong><span className="muted">/мес.</span></div>
            <div className="plan-features">{features.map((feature) => <p className="muted" key={feature}><Check aria-hidden="true" size={17} />{feature}</p>)}</div>
            {name === "Бесплатный" ? <Link className="ghost" href="/new">Попробовать бесплатно</Link> : <CheckoutButton plan={name === "Для преподавателя" ? "pro" : "student"} />}
          </article>
        ))}
      </section>
    </main>
  );
}
