import { NewProjectForm } from "@/components/new-project-form";
import { requireUserId } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await requireUserId();

  return (
    <main className="page new-page">
      <h1 className="page-title" style={{ fontSize: 52 }}>Новая презентация</h1>
      <p className="lead">Введите тему, выберите количество слайдов и при желании добавьте материалы. Сначала StudyDeck подготовит текст выступления, который можно отредактировать перед созданием слайдов.</p>
      <NewProjectForm />
    </main>
  );
}
