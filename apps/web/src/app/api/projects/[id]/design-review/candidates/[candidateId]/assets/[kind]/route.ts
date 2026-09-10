import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";
import { apiErrorResponse } from "@/lib/internal-api-route";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; candidateId: string; kind: "concept" | "editable-preview" | "background" }> },
) {
  const { id, candidateId, kind } = await params;
  if (kind !== "concept" && kind !== "editable-preview" && kind !== "background") {
    return NextResponse.json({ code: "ASSET_UNAVAILABLE", message: "Артефакт дизайна недоступен" }, { status: 404 });
  }
  try {
    const result = await internalFetch<{ url?: string }>(
      `/projects/${encodeURIComponent(id)}/design-review/candidates/${encodeURIComponent(candidateId)}/assets/${encodeURIComponent(kind)}`,
    );
    if (!result.url) return NextResponse.json({ code: "ASSET_UNAVAILABLE", message: "Артефакт дизайна недоступен" }, { status: 502 });
    const upstream = await fetch(result.url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) return NextResponse.json({ code: "ASSET_UNAVAILABLE", message: "Артефакт дизайна недоступен" }, { status: upstream.status || 502 });
    const headers = new Headers({
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "cache-control": "private, max-age=300",
    });
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
