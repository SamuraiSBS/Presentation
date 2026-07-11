import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return proxyInternalRequest(request, `/invitations/${encodeURIComponent(token)}/preview`, {
    body: "none",
    includeSearch: false,
  });
}
