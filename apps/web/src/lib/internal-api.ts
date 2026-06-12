import { redirect } from "next/navigation";
import { getAuthSession } from "./auth";

export async function requireUserId() {
  const session = await getAuthSession();
  if (!session?.user?.id) redirect("/sign-in");
  return session.user.id;
}

export async function internalFetch(path: string, init: RequestInit = {}) {
  const userId = await requireUserId();
  const baseUrl = process.env.INTERNAL_API_URL || "http://localhost:4000";
  const response = await fetch(`${baseUrl}/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.headers || {}),
      "x-user-id": userId,
      "x-internal-token": process.env.INTERNAL_API_TOKEN || "",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Internal API failed with ${response.status}`);
  }

  return response.json();
}
