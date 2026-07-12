import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { apiErrorResponse, proxyInternalRequest } from "@/lib/internal-api-route";

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: Context) {
  try {
    await requireAdminSession();
    const { path } = await context.params;
    if (!path?.length || path.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment))) return NextResponse.json({ code: "BAD_REQUEST", message: "Некорректный admin route" }, { status: 400 });
    return proxyInternalRequest(request, `/admin/${path.join("/")}`);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
