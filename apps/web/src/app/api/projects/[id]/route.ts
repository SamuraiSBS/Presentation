import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";
import { demoProject } from "@/lib/demo-project";
import { sanitizeProjectForDisplay } from "@/lib/presentation-display";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (process.env.NEXT_PUBLIC_DEMO_PREVIEW !== "false" && id === "demo") {
    return NextResponse.json(sanitizeProjectForDisplay(demoProject));
  }

  const project = await internalFetch(`/projects/${id}`);
  return NextResponse.json(sanitizeProjectForDisplay(project));
}
