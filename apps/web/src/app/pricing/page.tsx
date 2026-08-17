import Link from "next/link";
import { Check, Clock3, Presentation } from "lucide-react";
import { paidPlanCodes, planLimits, planPricesRub, planRank, type PaidPlanCode } from "@studydeck/shared";
import type { DashboardSummary } from "@/lib/account-types";
import { internalFetch } from "@/lib/internal-api";
import { planLabel } from "@/lib/project-ui";
import { CheckoutButton } from "@/components/checkout-button";

export const dynamic = "force-dynamic";

const descriptions: Record<"free" | PaidPlanCode, string> = {
  free: "Для первых трёх презентаций в месяц",
  student: "Для регулярных учебных задач",
  plus: "Для активной работы в течение недели",
  pro: "Для интенсивной подготовки и проектов",
};

export default async function PricingPage() {
  const dashboard = await internalFetch<DashboardSummary>("/dashboard");
  const usage = dashboard.usage;
  const activePlan = usage.planCode;
  const subscriptionEnds = usage.subscriptionExpiresAt
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(usage.subscriptionExpiresAt))
    : null;
  const resetAt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(new Date(usage.resetsAt));

  return (
    <main className="page pricing-page account-page">
      <section className="pricing-header">
        <p className="account-kicker">Тарифы</p>
        <h1 className="page-title">Выбирайте объём, который нужен сейчас</h1>
        <p className="lead">Без автопродления: каждая покупка открывает доступ на 30 дней. Оплата проходит через ЮKassa.</p>
      </section>

      <section className="billing-panel panel" aria-label="Статус лимита">
        <div><span className="status">{planLabel(activePlan)}</span><h2>Осталось {usage.remaining} из {usage.limit} генераций</h2></div>
        <p>{usage.reset === "week" ? "Недельный лимит" : "Месячный лимит"} обновится {resetAt}. Доступны презентации на {usage.allowedSlideCounts.join(", ")} слайдов.</p>
        {subscriptionEnds ? <p className="muted">Текущий платный доступ действует до {subscriptionEnds} включительно.</p> : null}
      </section>

      <section className="pricing-grid" aria-label="Тарифы Lazyum">
        {(["free", ...paidPlanCodes] as const).map((plan) => {
          const limits = planLimits[plan];
          const paid = plan !== "free";
          const lowerThanCurrent = paid && activePlan !== "free" && planRank[plan] < planRank[activePlan];
          const current = plan === activePlan;
          return (
            <article className={`pricing-card panel ${plan === "plus" ? "pricing-card-featured" : ""}`} key={plan}>
              {plan === "plus" ? <span className="recommended">Оптимальный объём</span> : null}
              <h2>{planLabel(plan)}</h2>
              <p className="muted">{descriptions[plan]}</p>
              <p className="free-price"><strong>{paid ? `${planPricesRub[plan]} ₽` : "0 ₽"}</strong><span>{paid ? "на 30 дней" : "навсегда"}</span></p>
              <div className="plan-features">
                <p><Check size={18} />{limits.generationLimit} {limits.reset === "week" ? "генераций в неделю" : "генерации в месяц"}</p>
                <p><Check size={18} />{limits.allowedSlideCounts.join(", ")} слайдов</p>
                <p><Check size={18} />PDF и PPTX</p>
              </div>
              {current ? <Link className="ghost" href="/new">Текущий тариф</Link> : plan === "free" ? <Link className="ghost" href="/new">Продолжить на Free</Link> : lowerThanCurrent ? <p className="muted">Понижение станет доступно после окончания текущего доступа.</p> : <CheckoutButton plan={plan} />}
            </article>
          );
        })}
      </section>

      <section className="coming-plan" aria-label="Условия оплаты">
        <Clock3 size={22} /><div><h2>Условия доступа просты</h2><p>Повторная покупка активного тарифа продлевает доступ ещё на 30 дней и сохраняет недельный счётчик. При переходе на более высокий тариф новый период начинается сразу, а недельный лимит обнуляется.</p></div><Presentation size={22} aria-hidden="true" />
      </section>
    </main>
  );
}
