import { requireUserId } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  await requireUserId();

  return (
    <main className="page">
      <section className="panel">
        <h1 className="page-title" style={{ fontSize: 48 }}>Биллинг</h1>
        <p className="lead">
          Здесь будет Stripe Customer Portal: управление подпиской, смена тарифа и история платежей.
          Backend webhook уже заложен в production-архитектуру.
        </p>
      </section>
    </main>
  );
}
