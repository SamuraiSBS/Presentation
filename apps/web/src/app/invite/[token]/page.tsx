import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { InvitationView } from "@/components/invitations/invitation-view";
import type { InvitationPreview } from "@/lib/account-types";
import { authOptions } from "@/lib/auth-options";
import { InternalApiError, internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id && process.env.ALLOW_DEV_AUTH !== "true") {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
  }

  let preview: InvitationPreview;
  try {
    preview = await internalFetch<InvitationPreview>(`/invitations/${encodeURIComponent(token)}/preview`);
  } catch (error) {
    if (!(error instanceof InternalApiError)) throw error;
    const status = error.body.code.includes("EXPIRED") ? "expired" : error.body.code.includes("USED") ? "used" : error.body.code.includes("REVOKED") ? "revoked" : undefined;
    if (!status) {
      return (
        <main className="page invite-page">
          <section className="panel invitation-card invitation-unavailable">
            <CircleAlert aria-hidden="true" size={34} />
            <h1>Приглашение недоступно</h1>
            <p>Проверь ссылку или попроси владельца проекта создать новое приглашение.</p>
            <Link className="button" href="/dashboard">Перейти в кабинет</Link>
          </section>
        </main>
      );
    }
    preview = { projectTitle: "Приглашение недоступно", owner: { id: "", name: null, image: null }, role: "viewer", status };
  }
  return <InvitationView initialPreview={preview} token={token} />;
}
