import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/internal-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; slideId: string }> }) {
  const { id, slideId } = await params;
  if (process.env.NEXT_PUBLIC_DEMO_PREVIEW !== "false" && id === "demo") {
    return NextResponse.json({ error: "Image upload is disabled in demo preview" }, { status: 400 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
  }

  const body = new FormData();
  body.append("file", file, file.name);

  const userId = await requireUserId();
  const baseUrl = process.env.INTERNAL_API_URL || "http://localhost:4000";
  const response = await fetch(`${baseUrl}/v1/projects/${id}/slides/${slideId}/assets`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "x-user-id": userId,
      "x-internal-token": process.env.INTERNAL_API_TOKEN || "",
    },
    body,
  });

  if (!response.ok) {
    return NextResponse.json({ error: await response.text() }, { status: response.status });
  }

  return NextResponse.json(await response.json());
}
