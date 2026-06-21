import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; slideId: string; elementId: string }> },
) {
  const { id, slideId, elementId } = await params;
  const result = await internalFetch(`/projects/${id}/slides/${slideId}/assets/${elementId}`);
  const upstream = await fetch(result.url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Image asset could not be loaded" }, { status: upstream.status || 502 });
  }

  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
  headers.set("cache-control", "private, max-age=300");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);

  return new NextResponse(upstream.body, { status: 200, headers });
}
