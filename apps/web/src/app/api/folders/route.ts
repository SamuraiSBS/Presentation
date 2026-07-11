import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function GET(request: Request) {
  return proxyInternalRequest(request, "/folders", { body: "none" });
}

export async function POST(request: Request) {
  return proxyInternalRequest(request, "/folders", { includeSearch: false });
}
