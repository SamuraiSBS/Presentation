import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";
import { apiErrorResponse } from "@/lib/internal-api-route";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; slideId: string; elementId: string }> },
) {
  const { id, slideId, elementId } = await params;
  try {
    const result = await internalFetch<{ url?: string }>(
      `/projects/${encodeURIComponent(id)}/slides/${encodeURIComponent(slideId)}/assets/${encodeURIComponent(elementId)}`,
    );
    if (!result.url) {
      return NextResponse.json(
        { code: "ASSET_UNAVAILABLE", message: "Изображение недоступно" },
        { status: 502 },
      );
    }
    const upstream = await fetch(result.url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { code: "ASSET_UNAVAILABLE", message: "Изображение недоступно" },
        { status: upstream.status || 502 },
      );
    }

    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
    headers.set("cache-control", "private, max-age=300");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
