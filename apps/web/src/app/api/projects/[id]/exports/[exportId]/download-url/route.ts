import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; exportId: string }> }) {
  const { id, exportId } = await params;
  return proxyInternalRequest(
    _request,
    `/projects/${encodeURIComponent(id)}/exports/${encodeURIComponent(exportId)}/download-url`,
    { body: "none", includeSearch: false },
  );
}
