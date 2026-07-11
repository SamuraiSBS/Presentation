import { NextResponse } from "next/server";
import { internalRequest } from "@/lib/internal-api";
import { apiErrorResponse, proxyInternalRequest } from "@/lib/internal-api-route";
import { sanitizeProjectForDisplay } from "@/lib/presentation-display";
import type { ProjectDetail } from "@/lib/account-types";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const upstream = await internalRequest<ProjectDetail>(`/projects/${encodeURIComponent(id)}`);
    return NextResponse.json(sanitizeProjectForDisplay(upstream.data), { status: upstream.status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyInternalRequest(request, `/projects/${encodeURIComponent(id)}`, { includeSearch: false });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyInternalRequest(request, `/projects/${encodeURIComponent(id)}`, { includeSearch: false, body: "none" });
}
