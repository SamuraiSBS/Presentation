import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyInternalRequest(_request, `/projects/${encodeURIComponent(id)}/narration`, { includeSearch: false });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyInternalRequest(request, `/projects/${encodeURIComponent(id)}/narration`, { includeSearch: false });
}
