import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; slideId: string }> }) {
  const { id, slideId } = await params;
  return proxyInternalRequest(request, `/projects/${encodeURIComponent(id)}/design-review/${encodeURIComponent(slideId)}/regenerate`, { includeSearch: false });
}
