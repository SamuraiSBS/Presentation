import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyInternalRequest(request, `/projects/${encodeURIComponent(id)}/design-review`, { includeSearch: false, body: "none" });
}
