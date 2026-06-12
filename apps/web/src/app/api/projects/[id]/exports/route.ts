import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await internalFetch(`/projects/${id}/exports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
  });
  return NextResponse.json(result);
}
