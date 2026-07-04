import { internalFetch } from "@/lib/internal-api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; exportId: string }> }) {
  const { id, exportId } = await params;
  const result = await internalFetch(`/projects/${id}/exports/${exportId}/download-url`) as { url?: string };

  if (!result.url) {
    return new Response("Download URL is unavailable", { status: 502 });
  }

  const upstream = await fetch(result.url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return new Response("Export file is unavailable", { status: upstream.status || 502 });
  }

  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
  headers.set("content-disposition", upstream.headers.get("content-disposition") || `attachment; filename="export-${exportId}"`);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);

  return new Response(upstream.body, { status: 200, headers });
}
