import { proxyInternalRequest } from "@/lib/internal-api-route";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return proxyInternalRequest(request, `/invitations/${encodeURIComponent(token)}/accept`, {
    includeSearch: false,
  });
}
