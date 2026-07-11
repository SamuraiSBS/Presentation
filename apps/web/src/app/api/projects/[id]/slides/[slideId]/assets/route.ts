import { NextResponse } from "next/server";
import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; slideId: string }> }) {
  const { id, slideId } = await params;
  if (process.env.NEXT_PUBLIC_DEMO_PREVIEW === "true" && id === "demo") {
    return NextResponse.json(
      { code: "DEMO_READ_ONLY", message: "В демо нельзя загружать изображения" },
      { status: 400 },
    );
  }

  return proxyInternalRequest(
    request,
    `/projects/${encodeURIComponent(id)}/slides/${encodeURIComponent(slideId)}/assets`,
    { includeSearch: false },
  );
}
