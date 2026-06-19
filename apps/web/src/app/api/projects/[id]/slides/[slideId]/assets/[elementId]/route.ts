import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; slideId: string; elementId: string }> },
) {
  const { id, slideId, elementId } = await params;
  const result = await internalFetch(`/projects/${id}/slides/${slideId}/assets/${elementId}`);
  return NextResponse.redirect(result.url);
}
