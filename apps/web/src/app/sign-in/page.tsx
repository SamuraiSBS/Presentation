import { SignInPanel } from "@/components/sign-in-panel";

export default function SignInPage() {
  return (
    <main className="page">
      <section className="panel" style={{ maxWidth: 520 }}>
        <h1 className="page-title" style={{ fontSize: 44 }}>Вход</h1>
        <p className="lead">Войдите, чтобы сохранять проекты, использовать лимиты тарифа и экспортировать презентации.</p>
        <SignInPanel />
      </section>
    </main>
  );
}
