import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await internalFetch(`/projects/${id}`);
  return NextResponse.json(project);
}
