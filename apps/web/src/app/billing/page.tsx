import { requireUserId } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  await requireUserId();

  return (
    <main className="page">
      <section className="panel">
        <h1 className="page-title" style={{ fontSize: 48 }}>Оплата и подписка</h1>
        <p className="lead">
          Здесь появятся управление подпиской, смена тарифа и история платежей.
          Обработка уведомлений платёжного сервиса уже предусмотрена в рабочей архитектуре.
        </p>
      </section>
    </main>
  );
}
