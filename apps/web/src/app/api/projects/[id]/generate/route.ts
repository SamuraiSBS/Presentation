import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const result = await internalFetch(`/projects/${id}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(result);
}
