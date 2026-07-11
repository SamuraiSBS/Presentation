import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
) {
  const { id, invitationId } = await params;
  return proxyInternalRequest(
    request,
    `/projects/${encodeURIComponent(id)}/invitations/${encodeURIComponent(invitationId)}`,
    { body: "none", includeSearch: false },
  );
}
