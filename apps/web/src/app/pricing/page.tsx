import Link from "next/link";
import { CalendarDays, Check, Clock3, Info, Presentation } from "lucide-react";
import { paidPlanCodes, planLimits, planPricesRub, planRank } from "@studydeck/shared";
import type { DashboardSummary } from "@/lib/account-types";
import { internalFetch } from "@/lib/internal-api";
import { planLabel } from "@/lib/project-ui";
import { CheckoutButton } from "@/components/checkout-button";

export const dynamic = "force-dynamic";


export default async function PricingPage() {
  const dashboard = await internalFetch<DashboardSummary>("/dashboard");
  const usage = dashboard.usage;
  const activePlan = usage.planCode;
  const subscriptionEnds = usage.subscriptionExpiresAt
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(usage.subscriptionExpiresAt))
    : null;
  const resetAt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(new Date(usage.resetsAt));
  const progressValue = usage.limit > 0 ? Math.min(100, Math.max(0, Math.round((usage.remaining / usage.limit) * 100))) : 0;
  const maxSlides = usage.allowedSlideCounts.length ? Math.max(...usage.allowedSlideCounts) : 0;

  return (
    <main className="page pricing-page account-page">
      <section className="pricing-header">
        <h1 className="page-title">Выберите тариф для своих презентаций</h1>
      </section>

      <section className="billing-panel panel" aria-label="Статус лимита">
        <div className="billing-heading">
          <span className="status billing-status">{planLabel(activePlan)}</span>
          <h2>Осталось {usage.remaining} из {usage.limit} генераций</h2>
        </div>
        <div className="billing-progress-group">
          <div
            className="billing-progress"
            role="progressbar"
            aria-label="Доступный лимит генераций"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressValue}
            aria-valuetext={`${usage.remaining} из ${usage.limit} генераций доступно`}
          >
            <span style={{ width: `${progressValue}%` }} />
          </div>
          <div className="billing-progress-caption">
            <span>{usage.limit - usage.remaining} использовано</span>
            <strong>{progressValue}% доступно</strong>
          </div>
        </div>
        <div className="billing-meta">
          <p className="billing-meta-item">
            <CalendarDays size={19} aria-hidden="true" />
            <span>
              <small>{usage.reset === "week" ? "Недельный лимит" : "Месячный лимит"}</small>
              <strong>Лимит обновится {resetAt}</strong>
            </span>
          </p>
          <p className="billing-meta-item">
            <Presentation size={19} aria-hidden="true" />
            <span>
              <small>Ограничение на презентацию</small>
              <strong>До {maxSlides} слайдов в одной презентации</strong>
            </span>
          </p>
          {subscriptionEnds ? (
            <p className="billing-meta-item billing-expiry">
              <Clock3 size={19} aria-hidden="true" />
              <span>
                <small>Платный доступ</small>
                <strong>Действует до {subscriptionEnds}</strong>
              </span>
            </p>
          ) : null}
        </div>
      </section>

      <section className="pricing-grid" aria-label="Тарифы Lazyum">
        {(["free", ...paidPlanCodes] as const).map((plan) => {
          const limits = planLimits[plan];
          const paid = plan !== "free";
          const lowerThanCurrent = paid && activePlan !== "free" && planRank[plan] < planRank[activePlan];
          const current = plan === activePlan;
          return (
            <article className={`pricing-card panel ${plan === "plus" ? "pricing-card-featured" : ""}`} key={plan}>
              <div className="pricing-card-badge-slot">
                {plan === "plus" ? <span className="recommended">Оптимальный объём</span> : null}
              </div>
              <h2 className="pricing-card-title">{planLabel(plan)}</h2>
              <div className="pricing-card-price">
                <strong>{paid ? `${planPricesRub[plan]} ₽` : "0 ₽"}</strong>
                <span>{paid ? "на 30 дней" : "навсегда"}</span>
              </div>
              <div className="plan-features">
                <p><Check size={18} aria-hidden="true" /><span>{limits.generationLimit} {limits.reset === "week" ? "генераций в неделю" : "генерации в месяц"}</span></p>
                <p><Check size={18} aria-hidden="true" /><span>{limits.allowedSlideCounts.join(", ")} слайдов</span></p>
                <p><Check size={18} aria-hidden="true" /><span>PDF и PPTX</span></p>
              </div>
              <div className="pricing-card-action">
                {current ? <Link className="ghost" href="/new">Текущий тариф</Link> : plan === "free" ? <Link className="ghost" href="/new">Продолжить на Free</Link> : lowerThanCurrent ? <p className="pricing-card-note muted">Понижение станет доступно после окончания текущего доступа.</p> : <CheckoutButton plan={plan} />}
              </div>
            </article>
          );
        })}
      </section>

      <section className="coming-plan" aria-label="Как работает доступ">
        <span className="coming-plan-icon"><Info size={20} aria-hidden="true" /></span>
        <div className="coming-plan-copy">
          <span className="coming-plan-label">Подсказка</span>
          <h2>Как работает доступ</h2>
          <p>Повторная покупка активного тарифа продлевает доступ ещё на 30 дней и сохраняет недельный счётчик. При переходе на более высокий тариф новый период начинается сразу, а недельный лимит обнуляется.</p>
        </div>
      </section>
    </main>
  );
}
