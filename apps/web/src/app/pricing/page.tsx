import Link from "next/link";
import { Check, Clock3, Folder, Presentation, Share2 } from "lucide-react";
import type { DashboardSummary } from "@/lib/account-types";
import { internalFetch } from "@/lib/internal-api";
import { planLabel } from "@/lib/project-ui";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const dashboard = await internalFetch<DashboardSummary>("/dashboard");
  const features = [`${dashboard.usage.limit} новых презентаций в календарный месяц`, "Экспорт в PDF и PPTX", "Папки одного уровня без лишней вложенности", "Совместные проекты с ролями редактора и зрителя"];
  return (
    <main className="page pricing-page account-page">
      <section className="pricing-header"><p className="account-kicker">Тариф</p><h1 className="page-title">Всё нужное для учёбы — без оплаты</h1><p className="lead">Сейчас StudyDeck работает без оплаты и банковской карты.</p></section>
      <section className="free-plan-card">
        <div className="free-plan-main"><span className="recommended">Текущий тариф</span><h2>{planLabel(dashboard.usage.planCode)}</h2><p className="free-price"><strong>0 ₽</strong><span>пока оплата отключена</span></p><div className="plan-features">{features.map((feature) => <p key={feature}><Check size={18} />{feature}</p>)}</div><Link className="button" href="/new">Создать презентацию</Link></div>
        <aside className="plan-notes"><div><Presentation size={21} /><span><strong>Лимит обновляется</strong>1-го числа по Москве</span></div><div><Folder size={21} /><span><strong>Работы сохраняются</strong>после исчерпания лимита</span></div><div><Share2 size={21} /><span><strong>Совместные проекты</strong>считаются владельцу</span></div></aside>
      </section>
      <section className="coming-plan"><Clock3 size={22} /><div><h2>Расширенные тарифы появятся позже</h2><p>Оплата пока отключена. Мы сообщим о дополнительных возможностях отдельно.</p></div><span>Скоро</span></section>
    </main>
  );
}
