import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; slideId: string }> }) {
  const { id, slideId } = await params;
  const result = await internalFetch(`/projects/${id}/slides/${slideId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
  });
  return NextResponse.json(result);
}
