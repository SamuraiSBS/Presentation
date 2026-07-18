import { proxyInternalRequest } from "@/lib/internal-api-route";

export function POST(request: Request) {
  return proxyInternalRequest(request, "/projects/defense", { includeSearch: false });
}
