import { NewProjectForm } from "@/components/new-project-form";
import { requireUserId } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await requireUserId();

  return (
    <main className="page new-page">
      <h1 className="page-title">О чём будешь выступать?</h1>
      <p className="lead">Сначала вместе подготовим текст, а после соберём из него слайды.</p>
      <NewProjectForm />
    </main>
  );
}
