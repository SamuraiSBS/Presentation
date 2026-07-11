import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyInternalRequest(request, `/folders/${encodeURIComponent(id)}`, { includeSearch: false });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyInternalRequest(request, `/folders/${encodeURIComponent(id)}`, { body: "none", includeSearch: false });
}
