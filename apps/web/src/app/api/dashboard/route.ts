import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function GET(request: Request) {
  return proxyInternalRequest(request, "/dashboard", { body: "none", includeSearch: false });
}
