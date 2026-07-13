import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  const { id, sourceId } = await params;
  return proxyInternalRequest(
    request,
    `/projects/${encodeURIComponent(id)}/sources/${encodeURIComponent(sourceId)}`,
    { includeSearch: false },
  );
}
