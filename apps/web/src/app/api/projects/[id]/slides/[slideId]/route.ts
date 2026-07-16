import { NextResponse } from "next/server";
import { updateDemoSlide } from "@/lib/demo-project";
import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; slideId: string }> }) {
  const { id, slideId } = await params;
  if (process.env.NEXT_PUBLIC_DEMO_PREVIEW === "true" && id === "demo") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { code: "BAD_REQUEST", message: "Не удалось прочитать изменения слайда" },
        { status: 400 },
      );
    }
    return NextResponse.json(updateDemoSlide(slideId, body));
  }

  return proxyInternalRequest(
    request,
    `/projects/${encodeURIComponent(id)}/slides/${encodeURIComponent(slideId)}`,
    { includeSearch: false },
  );
}
