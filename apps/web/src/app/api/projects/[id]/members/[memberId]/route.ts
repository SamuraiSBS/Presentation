import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  return proxyInternalRequest(
    request,
    `/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,
    { includeSearch: false },
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  return proxyInternalRequest(
    request,
    `/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,
    { body: "none", includeSearch: false },
  );
}
