import { NewProjectForm } from "@/components/new-project-form";
import { requireUserId } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await requireUserId();

  return (
    <main className="page">
      <h1 className="page-title" style={{ fontSize: 52 }}>Новая презентация</h1>
      <p className="lead">Опишите задачу, выберите учебный сценарий и прикрепите материалы. Генерация уйдет в очередь worker.</p>
      <NewProjectForm />
    </main>
  );
}
