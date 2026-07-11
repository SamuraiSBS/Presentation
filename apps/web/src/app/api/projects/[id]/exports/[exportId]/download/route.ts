import { internalFetch } from "@/lib/internal-api";
import { apiErrorResponse } from "@/lib/internal-api-route";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; exportId: string }> }) {
  const { id, exportId } = await params;
  try {
    const result = await internalFetch<{ url?: string }>(
      `/projects/${encodeURIComponent(id)}/exports/${encodeURIComponent(exportId)}/download-url`,
    );
    if (!result.url) {
      return Response.json(
        { code: "EXPORT_UNAVAILABLE", message: "Файл пока недоступен" },
        { status: 502 },
      );
    }

    const upstream = await fetch(result.url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { code: "EXPORT_UNAVAILABLE", message: "Файл пока недоступен" },
        { status: upstream.status || 502 },
      );
    }

    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
    headers.set("content-disposition", upstream.headers.get("content-disposition") || `attachment; filename="export-${exportId}"`);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
