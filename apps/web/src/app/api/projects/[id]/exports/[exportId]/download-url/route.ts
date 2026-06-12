import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; exportId: string }> }) {
  const { id, exportId } = await params;
  const result = await internalFetch(`/projects/${id}/exports/${exportId}/download-url`);
  return NextResponse.json(result);
}
