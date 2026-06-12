import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await internalFetch(`/projects/${id}/generate`, { method: "POST" });
  return NextResponse.json(result);
}
