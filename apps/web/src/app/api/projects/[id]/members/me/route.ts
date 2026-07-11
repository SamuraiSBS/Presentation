import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyInternalRequest(request, `/projects/${encodeURIComponent(id)}/members/me`, {
    body: "none",
    includeSearch: false,
  });
}
