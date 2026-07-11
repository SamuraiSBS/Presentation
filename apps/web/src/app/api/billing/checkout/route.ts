import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function POST(request: Request) {
  return proxyInternalRequest(request, "/billing/checkout", { includeSearch: false });
}
