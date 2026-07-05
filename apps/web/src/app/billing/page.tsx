import { requireUserId } from "@/lib/internal-api";
import Link from "next/link";
import { CreditCard, Tags } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  await requireUserId();

  return (
    <main className="page">
      <section className="panel billing-panel">
        <span className="icon-surface icon-surface-large"><CreditCard aria-hidden="true" size={28} /></span>
        <h1 className="page-title">Подписка</h1>
        <p className="lead">
          Управление подпиской ещё настраиваем. Пока выбрать план можно на странице тарифов.
        </p>
        <Link className="button" href="/pricing"><Tags aria-hidden="true" size={18} />Выбрать тариф</Link>
      </section>
    </main>
  );
}
