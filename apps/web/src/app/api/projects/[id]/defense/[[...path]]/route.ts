import { proxyInternalRequest } from "@/lib/internal-api-route";

type DefenseRouteContext = {
  params: Promise<{ id: string; path?: string[] }>;
};

async function proxyDefense(request: Request, { params }: DefenseRouteContext) {
  const { id, path = [] } = await params;
  const suffix = path.length
    ? `/${path.map((segment) => encodeURIComponent(segment)).join("/")}`
    : "";

  return proxyInternalRequest(
    request,
    `/projects/${encodeURIComponent(id)}/defense${suffix}`,
  );
}

export const GET = proxyDefense;
export const POST = proxyDefense;
export const PUT = proxyDefense;
export const PATCH = proxyDefense;
export const DELETE = proxyDefense;
