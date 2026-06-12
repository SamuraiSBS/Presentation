import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";
import { updateDemoSlide } from "@/lib/demo-project";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; slideId: string }> }) {
  const { id, slideId } = await params;
  const body = await request.json();

  if (process.env.NEXT_PUBLIC_DEMO_PREVIEW !== "false" && id === "demo") {
    return NextResponse.json(updateDemoSlide(slideId, body));
  }

  const result = await internalFetch(`/projects/${id}/slides/${slideId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(result);
}
