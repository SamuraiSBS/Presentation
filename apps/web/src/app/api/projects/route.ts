import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function GET() {
  const projects = await internalFetch("/projects");
  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const body = await request.json();
  const project = await internalFetch("/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(project);
}
