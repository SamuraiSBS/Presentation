import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await internalFetch(`/projects/${id}/narration`, { method: "POST" });
  return NextResponse.json(result);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const result = await internalFetch(`/projects/${id}/narration`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(result);
}
