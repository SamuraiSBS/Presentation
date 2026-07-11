import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyInternalRequest(request, `/projects/${encodeURIComponent(id)}/duplicate`, { includeSearch: false });
}
