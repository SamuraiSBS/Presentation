import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function GET(request: Request) {
  return proxyInternalRequest(request, "/users/me", { body: "none", includeSearch: false });
}

export async function DELETE(request: Request) {
  return proxyInternalRequest(request, "/users/me", { includeSearch: false });
}
