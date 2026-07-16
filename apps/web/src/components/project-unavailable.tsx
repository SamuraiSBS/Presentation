import Link from "next/link";

export function ProjectUnavailable({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="panel project-unavailable" role="alert">
      <h1>{title}</h1>
      <p className="muted">{description}</p>
      <Link className="button" href="/projects">Открыть презентации</Link>
    </section>
  );
}
