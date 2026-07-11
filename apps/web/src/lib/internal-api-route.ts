import "server-only";

import { NextResponse } from "next/server";
import {
  internalRequest,
  normalizeUnknownApiError,
  type ApiErrorBody,
} from "@/lib/internal-api";

type ProxyOptions = {
  method?: string;
  includeSearch?: boolean;
  body?: "auto" | "none";
};

export async function proxyInternalRequest(
  request: Request,
  path: string,
  options: ProxyOptions = {},
): Promise<NextResponse> {
  try {
    const method = (options.method || request.method || "GET").toUpperCase();
    const search = options.includeSearch === false ? "" : new URL(request.url).search;
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    let body: BodyInit | undefined;

    if (options.body !== "none" && method !== "GET" && method !== "HEAD") {
      if (contentType?.includes("multipart/form-data")) {
        body = await request.formData();
      } else {
        const text = await request.text();
        if (text) body = text;
        if (contentType) headers.set("content-type", contentType);
      }
    }

    const upstream = await internalRequest(`${path}${search}`, { method, headers, body });
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(upstream.data, { status: upstream.status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export function apiErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  const normalized = normalizeUnknownApiError(error);
  return NextResponse.json(normalized.body, { status: normalized.status });
}
