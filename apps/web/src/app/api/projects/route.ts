import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function GET(request: Request) {
  return proxyInternalRequest(request, "/projects", { body: "none" });
}

export async function POST(request: Request) {
  return proxyInternalRequest(request, "/projects", { includeSearch: false });
}
