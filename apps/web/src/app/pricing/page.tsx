import Link from "next/link";
import { CheckoutButton } from "@/components/checkout-button";

export default function PricingPage() {
  const plans = [
    ["Free", "$0", "3 презентации/месяц", "До 10 слайдов", "PDF export"],
    ["Student", "$9", "60 презентаций/месяц", "До 14 слайдов", "PDF + PPTX"],
    ["Teacher Pro", "$19", "200 презентаций/месяц", "До 20 слайдов", "Приоритетная очередь"],
  ];

  return (
    <main className="page">
      <h1 className="page-title">Тарифы</h1>
      <p className="lead">Freemium-модель для студентов и преподавателей. Stripe checkout подключается через billing backend и webhooks.</p>
      <section className="grid">
        {plans.map(([name, price, ...features]) => (
          <article className="card" key={name}>
            <h2>{name}</h2>
            <div className="price"><strong>{price}</strong><span className="muted">/mo</span></div>
            {features.map((feature) => <p className="muted" key={feature}>{feature}</p>)}
            {name === "Free" ? <Link className="ghost" href="/new">Начать бесплатно</Link> : <CheckoutButton plan={name === "Teacher Pro" ? "pro" : "student"} />}
          </article>
        ))}
      </section>
    </main>
  );
}
